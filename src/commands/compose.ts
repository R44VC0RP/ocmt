import * as p from "@clack/prompts";
import color from "picocolors";
import {
  isGitRepo,
  getStatus,
  stageAll,
  stageFiles,
  unstageAll,
  commit,
  getAllFileDiffs,
  createDiffForUntracked,
  type GitStatus,
  type FileDiff,
} from "../utils/git";
import {
  analyzeChangesForComposer,
  cleanup,
  type ComposerFileInput,
  type ComposerDraftOutput,
} from "../lib/opencode";
import { parseModelString } from "../lib/config";
import type { DraftCommit, FileChange, ComposeOptions } from "../types/composer";

/**
 * Convert FileDiff to ComposerFileInput
 */
function toComposerInput(fileDiff: FileDiff): ComposerFileInput {
  return {
    path: fileDiff.path,
    additions: fileDiff.stats.additions,
    deletions: fileDiff.stats.deletions,
    status: fileDiff.stats.status,
    diff: fileDiff.diff,
  };
}

/**
 * Convert AI output to internal DraftCommit format
 */
function toDraftCommit(
  aiDraft: ComposerDraftOutput,
  allFiles: Map<string, FileChange>
): DraftCommit {
  const files: FileChange[] = aiDraft.files
    .map((path) => allFiles.get(path))
    .filter((f): f is FileChange => f !== undefined);

  return {
    id: aiDraft.id,
    message: aiDraft.message,
    files,
  };
}

/**
 * Display a single draft commit
 */
function displayDraft(draft: DraftCommit, index: number): void {
  const fileList = draft.files
    .map((f) => {
      const stats = color.dim(`(+${f.additions}/-${f.deletions})`);
      const statusIcon =
        f.status === "added"
          ? color.green("+")
          : f.status === "deleted"
            ? color.red("-")
            : color.yellow("~");
      return `    ${statusIcon} ${f.path} ${stats}`;
    })
    .join("\n");

  p.log.message(
    `${color.cyan(`[${index + 1}]`)} ${color.bold(draft.message)}\n${fileList}`
  );
}

/**
 * Display all draft commits
 */
function displayAllDrafts(drafts: DraftCommit[]): void {
  p.log.info(color.bold(`\nProposed ${drafts.length} commits:\n`));
  drafts.forEach((draft, i) => displayDraft(draft, i));
  console.log();
}

/**
 * Apply a single draft commit
 */
async function applyDraft(draft: DraftCommit): Promise<string> {
  // Unstage everything first
  await unstageAll();

  // Stage only the files in this draft
  const filePaths = draft.files.map((f) => f.path);
  await stageFiles(filePaths);

  // Commit
  return commit(draft.message);
}

/**
 * Main compose command
 */
export async function composeCommand(options: ComposeOptions): Promise<void> {
  p.intro(color.bgMagenta(color.black(" oc compose ")));

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

  // Check for any changes (staged or unstaged)
  if (!hasChanges(status)) {
    p.outro(color.yellow("Nothing to compose, working tree clean"));
    cleanup();
    process.exit(0);
  }

  // If there are unstaged changes, offer to stage them
  if (status.staged.length === 0) {
    p.log.warn("No staged changes found");
    const unstagedFiles = [...status.unstaged, ...status.untracked]
      .map((file) => `  ${color.dim(file)}`)
      .join("\n");
    p.log.info(`Unstaged/Untracked files:\n${unstagedFiles}`);

    if (!options.yes) {
      const shouldStage = await p.confirm({
        message: "Stage all changes for composition?",
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

  // Get all file diffs
  const fileDiffs = await getAllFileDiffs(true);

  // Also handle untracked files that were just staged
  for (const file of status.untracked) {
    const diff = await createDiffForUntracked(file);
    if (diff) {
      const lines = diff.split("\n").filter((l) => l.startsWith("+")).length;
      fileDiffs.push({
        path: file,
        diff,
        stats: {
          path: file,
          additions: lines,
          deletions: 0,
          status: "added",
        },
      });
    }
  }

  if (fileDiffs.length === 0) {
    p.outro(color.yellow("No diff content to analyze"));
    cleanup();
    process.exit(0);
  }

  // Show summary
  p.log.success(
    `Found ${color.bold(String(fileDiffs.length))} changed files to compose`
  );

  // If only 1 file, suggest using regular commit
  if (fileDiffs.length === 1) {
    p.log.info(
      color.dim(
        "Tip: For single-file changes, consider using `oc` directly instead of `oc compose`"
      )
    );
  }

  // Build file map for later use
  const fileMap = new Map<string, FileChange>();
  for (const fd of fileDiffs) {
    fileMap.set(fd.path, {
      path: fd.path,
      additions: fd.stats.additions,
      deletions: fd.stats.deletions,
      status: fd.stats.status,
      diff: fd.diff,
    });
  }

  // Ask for additional instructions (optional)
  let instructions = options.instructions;
  if (!options.yes && !instructions) {
    const userInstructions = await p.text({
      message: "Additional instructions for AI? (optional, press Enter to skip)",
      placeholder: "e.g., Keep all test files in a separate commit",
    });

    if (p.isCancel(userInstructions)) {
      p.cancel("Aborted");
      cleanup();
      process.exit(0);
    }

    instructions = userInstructions || undefined;
  }

  // Analyze changes with AI
  const spinner = p.spinner();
  spinner.start("Analyzing changes with AI...");

  let drafts: DraftCommit[];
  try {
    const analysis = await analyzeChangesForComposer({
      files: fileDiffs.map(toComposerInput),
      instructions,
      model: parseModelString(options.model),
    });

    drafts = analysis.drafts.map((d) => toDraftCommit(d, fileMap));
    spinner.stop("Analysis complete");

    if (analysis.overall_reasoning) {
      p.log.info(color.dim(`Strategy: ${analysis.overall_reasoning}`));
    }
  } catch (error: any) {
    spinner.stop("Analysis failed");
    p.cancel(error.message);
    cleanup();
    process.exit(1);
  }

  // Display drafts
  displayAllDrafts(drafts);

  // Interactive loop
  let done = false;
  while (!done) {
    if (options.yes) {
      // Auto-apply all
      done = true;
      await applyAllDrafts(drafts);
    } else {
      const action = await p.select({
        message: "What would you like to do?",
        options: [
          {
            value: "apply_all",
            label: `Apply all ${drafts.length} commits`,
            hint: "Creates commits in order",
          },
          {
            value: "edit_message",
            label: "Edit a commit message",
          },
          {
            value: "view_draft",
            label: "View draft details",
          },
          {
            value: "regenerate",
            label: "Regenerate analysis",
            hint: "Ask AI to re-analyze",
          },
          {
            value: "cancel",
            label: "Cancel",
          },
        ],
      });

      if (p.isCancel(action) || action === "cancel") {
        p.cancel("Aborted");
        cleanup();
        process.exit(0);
      }

      switch (action) {
        case "apply_all":
          await applyAllDrafts(drafts);
          done = true;
          break;

        case "edit_message":
          drafts = await editDraftMessage(drafts);
          displayAllDrafts(drafts);
          break;

        case "view_draft":
          await viewDraftDetails(drafts);
          break;

        case "regenerate":
          spinner.start("Re-analyzing changes with AI...");
          try {
            const analysis = await analyzeChangesForComposer({
              files: fileDiffs.map(toComposerInput),
              instructions,
              model: parseModelString(options.model),
            });
            drafts = analysis.drafts.map((d) => toDraftCommit(d, fileMap));
            spinner.stop("Analysis complete");
            displayAllDrafts(drafts);
          } catch (error: any) {
            spinner.stop("Analysis failed");
            p.log.error(error.message);
          }
          break;
      }
    }
  }

  p.outro(color.green("Done!"));
  cleanup();
  process.exit(0);
}

/**
 * Apply all drafts in sequence
 */
async function applyAllDrafts(drafts: DraftCommit[]): Promise<void> {
  const s = p.spinner();

  for (let i = 0; i < drafts.length; i++) {
    const draft = drafts[i];
    s.start(`Creating commit ${i + 1}/${drafts.length}: ${draft.message}`);

    try {
      await applyDraft(draft);
      s.stop(
        `${color.green("✓")} Commit ${i + 1}/${drafts.length}: ${draft.message}`
      );
    } catch (error: any) {
      s.stop(`${color.red("✗")} Failed to create commit ${i + 1}`);
      throw error;
    }
  }

  p.log.success(`Successfully created ${drafts.length} commits!`);
}

/**
 * Edit a draft message interactively
 */
async function editDraftMessage(drafts: DraftCommit[]): Promise<DraftCommit[]> {
  const draftOptions = drafts.map((d, i) => ({
    value: i,
    label: `[${i + 1}] ${d.message}`,
    hint: `${d.files.length} files`,
  }));

  const selectedIndex = await p.select({
    message: "Which commit message to edit?",
    options: draftOptions,
  });

  if (p.isCancel(selectedIndex)) {
    return drafts;
  }

  const draft = drafts[selectedIndex as number];
  const newMessage = await p.text({
    message: "Enter new commit message:",
    initialValue: draft.message,
    validate: (value) => {
      if (!value.trim()) return "Commit message cannot be empty";
    },
  });

  if (p.isCancel(newMessage)) {
    return drafts;
  }

  // Update the draft
  const updatedDrafts = [...drafts];
  updatedDrafts[selectedIndex as number] = {
    ...draft,
    message: newMessage,
  };

  p.log.success("Commit message updated");
  return updatedDrafts;
}

/**
 * View details of a specific draft
 */
async function viewDraftDetails(drafts: DraftCommit[]): Promise<void> {
  const draftOptions = drafts.map((d, i) => ({
    value: i,
    label: `[${i + 1}] ${d.message}`,
    hint: `${d.files.length} files`,
  }));

  const selectedIndex = await p.select({
    message: "Which draft to view?",
    options: draftOptions,
  });

  if (p.isCancel(selectedIndex)) {
    return;
  }

  const draft = drafts[selectedIndex as number];

  console.log();
  p.log.info(color.bold(`Draft ${(selectedIndex as number) + 1}: ${draft.message}`));
  console.log();

  for (const file of draft.files) {
    const stats = `+${file.additions}/-${file.deletions}`;
    const statusIcon =
      file.status === "added"
        ? color.green("A")
        : file.status === "deleted"
          ? color.red("D")
          : file.status === "renamed"
            ? color.blue("R")
            : color.yellow("M");

    p.log.message(`${statusIcon} ${file.path} ${color.dim(`(${stats})`)}`);

    // Show truncated diff
    if (file.diff) {
      const lines = file.diff.split("\n").slice(0, 15);
      const truncated = file.diff.split("\n").length > 15;
      console.log(color.dim(lines.join("\n")));
      if (truncated) {
        console.log(color.dim("... (truncated)"));
      }
    }
    console.log();
  }
}

function hasChanges(status: GitStatus): boolean {
  return (
    status.staged.length > 0 ||
    status.unstaged.length > 0 ||
    status.untracked.length > 0
  );
}
