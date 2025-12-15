import chalk from "chalk";
import inquirer from "inquirer";
import ora from "ora";
import {
  isGitRepo,
  getReleases,
  getCommitsBetween,
  getLog,
} from "../utils/git";
import { generateChangelog } from "../lib/opencode";

export interface ChangelogOptions {
  from?: string;
  to?: string;
}

/**
 * Changelog command (WIP)
 * - Shows previous commits/releases
 * - Lets you select a starting point
 * - Generates a changelog up to the selected point
 */
export async function changelogCommand(options: ChangelogOptions): Promise<void> {
  console.log(chalk.yellow("\n[WIP] Changelog generation\n"));

  // Check if we're in a git repo
  if (!(await isGitRepo())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  let fromRef = options.from;
  const toRef = options.to || "HEAD";

  // If no --from specified, show options to select
  if (!fromRef) {
    const spinner = ora("Fetching releases and commits...").start();

    const releases = await getReleases();
    const recentLog = await getLog({ limit: 20 });
    const recentCommits = recentLog.split("\n").filter(Boolean);

    spinner.stop();

    // Build choices
    const choices: Array<{ name: string; value: string }> = [];

    if (releases.length > 0) {
      choices.push(
        new inquirer.Separator("--- Releases/Tags ---") as any,
        ...releases.slice(0, 10).map((tag) => ({
          name: `${chalk.green(tag)} (release)`,
          value: tag,
        }))
      );
    }

    if (recentCommits.length > 0) {
      choices.push(
        new inquirer.Separator("--- Recent Commits ---") as any,
        ...recentCommits.map((commit) => {
          const [hash, ...msg] = commit.split(" ");
          return {
            name: `${chalk.yellow(hash)} ${msg.join(" ")}`,
            value: hash,
          };
        })
      );
    }

    if (choices.length === 0) {
      console.log(chalk.yellow("No releases or commits found"));
      process.exit(0);
    }

    const { selectedRef } = await inquirer.prompt([
      {
        type: "list",
        name: "selectedRef",
        message: "Select starting point for changelog:",
        choices,
        pageSize: 15,
      },
    ]);

    fromRef = selectedRef;
  }

  // Get commits between refs
  const spinner = ora(`Fetching commits ${fromRef}..${toRef}...`).start();

  try {
    const commits = await getCommitsBetween(fromRef!, toRef);
    spinner.succeed(`Found ${commits.length} commits`);

    if (commits.length === 0) {
      console.log(chalk.yellow("No commits found in the specified range"));
      process.exit(0);
    }

    // Display commits
    console.log(chalk.cyan("\nCommits to include in changelog:"));
    commits.forEach((c) => {
      console.log(chalk.dim(`  ${c.hash} ${c.message}`));
    });

    // Generate changelog
    const generateSpinner = ora("Generating changelog...").start();

    try {
      const changelog = await generateChangelog({
        commits,
        fromRef: fromRef!,
        toRef,
      });

      generateSpinner.succeed("Changelog generated");

      console.log(chalk.cyan("\n--- Generated Changelog ---\n"));
      console.log(changelog);
      console.log(chalk.cyan("\n--- End Changelog ---\n"));

      // Ask what to do with it
      const { action } = await inquirer.prompt([
        {
          type: "list",
          name: "action",
          message: "What would you like to do?",
          choices: [
            { name: "Copy to clipboard (not implemented)", value: "copy" },
            { name: "Save to CHANGELOG.md (not implemented)", value: "save" },
            { name: "Done", value: "done" },
          ],
        },
      ]);

      if (action === "copy") {
        console.log(chalk.yellow("Clipboard copy not yet implemented"));
      } else if (action === "save") {
        console.log(chalk.yellow("File save not yet implemented"));
      }
    } catch (error: any) {
      generateSpinner.fail("Failed to generate changelog");
      console.error(chalk.red(error.message));
      process.exit(1);
    }
  } catch (error: any) {
    spinner.fail("Failed to fetch commits");
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
