import * as p from "@clack/prompts";
import color from "picocolors";
import {
  isGitRepo,
  getStatus,
  getStagedDiff,
  stageAll,
  commit,
  type GitStatus,
} from "../utils/git";
import { generateCommitMessage, cleanup } from "../lib/opencode";

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
  p.intro(color.bgCyan(color.black(" oc ")));

  // Check if we're in a git repo
  if (!(await isGitRepo())) {
    p.cancel("Not a git repository");
    cleanup();
    process.exit(1);
  }

  // Get current status
  let status = await getStatus();

  // If --all flag, stage everything first
  if (options.all && hasChanges(status)) {
    const s = p.spinner();
    s.start("Staging all changes");
    await stageAll();
    s.stop("All changes staged");
    status = await getStatus();
  }

  // Check for staged changes
  if (status.staged.length === 0) {
    // No staged changes - check if there are unstaged changes
    if (status.unstaged.length === 0 && status.untracked.length === 0) {
      p.outro(color.yellow("Nothing to commit, working tree clean"));
      cleanup();
      process.exit(0);
    }

    // Show unstaged/untracked files
    p.log.warn("No staged changes found");
    const unstagedFiles = [...status.unstaged, ...status.untracked]
      .map((file) => `  ${color.dim(file)}`)
      .join("\n");
    p.log.info(`Unstaged/Untracked files:\n${unstagedFiles}`);

    if (!options.yes) {
      const shouldStage = await p.confirm({
        message: "Stage all changes?",
        initialValue: true,
      });

      if (p.isCancel(shouldStage) || !shouldStage) {
        p.cancel("Aborted. Stage changes with `git add` first.");
        cleanup();
        process.exit(0);
      }
    }

    const s = p.spinner();
    s.start("Staging all changes");
    await stageAll();
    s.stop("All changes staged");
    status = await getStatus();
  }

  // Display staged files
  const stagedFiles = status.staged
    .map((file) => `  ${color.green("+")} ${file}`)
    .join("\n");
  p.log.success(`Staged changes:\n${stagedFiles}`);

  // Get the diff
  const diff = await getStagedDiff();

  if (!diff) {
    p.outro(color.yellow("No diff content to analyze"));
    cleanup();
    process.exit(0);
  }

  // Show the number of diff lines
  const diffLineLength = diff.split("\n").length;
  p.log.info(`Diff: ${diffLineLength} lines`);

  // If message provided, use it directly
  let commitMessage = options.message;

  if (!commitMessage) {
    // Generate commit message using AI
    const s = p.spinner();
    s.start("Generating commit message");

    try {
      commitMessage = await generateCommitMessage({ diff });
      s.stop("Commit message generated");
    } catch (error: any) {
      s.stop("Failed to generate commit message");
      p.cancel(error.message);
      cleanup();
      process.exit(1);
    }
  }

  // Show the commit message
  p.log.step(
    `Proposed commit message:\n${color.white(`  "${commitMessage}"`)}`,
  );

  // Confirm commit (unless --yes)
  if (!options.yes) {
    const action = await p.select({
      message: "What would you like to do?",
      options: [
        { value: "commit", label: "Commit with this message" },
        { value: "edit", label: "Edit message" },
        { value: "regenerate", label: "Regenerate message" },
        { value: "cancel", label: "Cancel" },
      ],
    });

    if (p.isCancel(action) || action === "cancel") {
      p.cancel("Aborted");
      cleanup();
      process.exit(0);
    }

    if (action === "edit") {
      const editedMessage = await p.text({
        message: "Enter commit message:",
        initialValue: commitMessage,
        validate: (value) => {
          if (!value.trim()) return "Commit message cannot be empty";
        },
      });

      if (p.isCancel(editedMessage)) {
        p.cancel("Aborted");
        cleanup();
        process.exit(0);
      }

      commitMessage = editedMessage;
    }

    if (action === "regenerate") {
      const s = p.spinner();
      s.start("Regenerating commit message");

      try {
        commitMessage = await generateCommitMessage({ diff });
        s.stop("Commit message regenerated");
      } catch (error: any) {
        s.stop("Failed to regenerate commit message");
        p.cancel(error.message);
        cleanup();
        process.exit(1);
      }

      p.log.step(`New commit message:\n${color.white(`  "${commitMessage}"`)}`);

      const confirmNew = await p.confirm({
        message: "Use this message?",
        initialValue: true,
      });

      if (p.isCancel(confirmNew) || !confirmNew) {
        p.cancel("Aborted");
        cleanup();
        process.exit(0);
      }
    }
  }

  // Perform the commit
  const s = p.spinner();
  s.start("Committing");

  try {
    const result = await commit(commitMessage!);
    s.stop(`Committed successfully!\n${color.dim(result)}`);
    p.outro(color.green("Done!"));
    cleanup();
    process.exit(0);
  } catch (error: any) {
    s.stop("Commit failed");
    p.cancel(error.message);
    cleanup();
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
