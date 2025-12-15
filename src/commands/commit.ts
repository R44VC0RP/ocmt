import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
  isGitRepo,
  getStatus,
  getStagedDiff,
  stageAll,
  commit,
  type GitStatus,
} from "../utils/git";
import { generateCommitMessage } from "../lib/opencode";

export interface CommitOptions {
  message?: string;
  all?: boolean;
  yes?: boolean;
}

/**
 * Main commit command
 * - Views staged changes
 * - If none staged, offers to stage changes
 * - Generates AI commit message from diff
 * - Commits with the generated/provided message
 */
export async function commitCommand(options: CommitOptions): Promise<void> {
  // Check if we're in a git repo
  if (!(await isGitRepo())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  // Get current status
  const status = await getStatus();

  // If --all flag, stage everything first
  if (options.all) {
    if (hasChanges(status)) {
      const spinner = ora("Staging all changes...").start();
      await stageAll();
      spinner.succeed("All changes staged");
      // Refresh status
      const newStatus = await getStatus();
      Object.assign(status, newStatus);
    }
  }

  // Check for staged changes
  if (status.staged.length === 0) {
    // No staged changes - check if there are unstaged changes
    if (status.unstaged.length === 0 && status.untracked.length === 0) {
      console.log(chalk.yellow("Nothing to commit, working tree clean"));
      process.exit(0);
    }

    // Offer to stage changes
    console.log(chalk.yellow("\nNo staged changes found."));
    console.log("\nUnstaged/Untracked files:");
    [...status.unstaged, ...status.untracked].forEach((file) => {
      console.log(chalk.dim(`  ${file}`));
    });

    if (!options.yes) {
      const { shouldStage } = await inquirer.prompt([
        {
          type: "confirm",
          name: "shouldStage",
          message: "Would you like to stage all changes?",
          default: true,
        },
      ]);

      if (!shouldStage) {
        console.log(chalk.dim("Aborted. Stage changes with `git add` first."));
        process.exit(0);
      }
    }

    const spinner = ora("Staging all changes...").start();
    await stageAll();
    spinner.succeed("All changes staged");

    // Refresh status
    const newStatus = await getStatus();
    Object.assign(status, newStatus);
  }

  // Display staged files
  console.log(chalk.green("\nStaged changes:"));
  status.staged.forEach((file) => {
    console.log(chalk.green(`  + ${file}`));
  });

  // Get the diff
  const diff = await getStagedDiff();

  if (!diff) {
    console.log(chalk.yellow("No diff content to analyze"));
    process.exit(0);
  }

  // Show diff summary
  const diffLines = diff.split("\n").length;
  console.log(chalk.dim(`\nDiff: ${diffLines} lines`));

  // If message provided, use it directly
  let commitMessage = options.message;

  if (!commitMessage) {
    // Generate commit message using AI
    const spinner = ora("Generating commit message...").start();

    try {
      commitMessage = await generateCommitMessage({ diff });
      spinner.succeed("Commit message generated");
    } catch (error: any) {
      spinner.fail("Failed to generate commit message");
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  }

  // Show the commit message
  console.log(chalk.cyan("\nProposed commit message:"));
  console.log(chalk.white(`  "${commitMessage}"`));

  // Confirm commit (unless --yes)
  if (!options.yes) {
    const { action } = await inquirer.prompt([
      {
        type: "list",
        name: "action",
        message: "What would you like to do?",
        choices: [
          { name: "Commit with this message", value: "commit" },
          { name: "Edit message", value: "edit" },
          { name: "Regenerate message", value: "regenerate" },
          { name: "Cancel", value: "cancel" },
        ],
      },
    ]);

    if (action === "cancel") {
      console.log(chalk.dim("Aborted."));
      process.exit(0);
    }

    if (action === "edit") {
      const { editedMessage } = await inquirer.prompt([
        {
          type: "input",
          name: "editedMessage",
          message: "Enter commit message:",
          default: commitMessage,
        },
      ]);
      commitMessage = editedMessage;
    }

    if (action === "regenerate") {
      const spinner = ora("Regenerating commit message...").start();
      try {
        commitMessage = await generateCommitMessage({ diff });
        spinner.succeed("Commit message regenerated");
        console.log(chalk.cyan("\nNew commit message:"));
        console.log(chalk.white(`  "${commitMessage}"`));

        const { confirmNew } = await inquirer.prompt([
          {
            type: "confirm",
            name: "confirmNew",
            message: "Use this message?",
            default: true,
          },
        ]);

        if (!confirmNew) {
          console.log(chalk.dim("Aborted."));
          process.exit(0);
        }
      } catch (error: any) {
        spinner.fail("Failed to regenerate commit message");
        console.error(chalk.red(error.message));
        process.exit(1);
      }
    }
  }

  // Perform the commit
  const spinner = ora("Committing...").start();

  try {
    const result = await commit(commitMessage!);
    spinner.succeed("Committed successfully!");
    console.log(chalk.dim(result));
  } catch (error: any) {
    spinner.fail("Commit failed");
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

function hasChanges(status: GitStatus): boolean {
  return (
    status.staged.length > 0 ||
    status.unstaged.length > 0 ||
    status.untracked.length > 0
  );
}
