import * as p from "@clack/prompts";
import color from "picocolors";
import { spawn } from "child_process";
import { getConfig } from "./config";
import { runDeslopEdits } from "./opencode";
import {
  getDiffBetween,
  getDefaultBranch,
  getStagedDiff,
  getStatus,
  git,
  stageFiles,
} from "../utils/git";

export type DeslopFlowResult = "continue" | "abort" | "updated";

export async function getAndValidateStagedDiff(
  emptyMessage: string = "No diff content to analyze",
): Promise<string | null> {
  const diff = await getStagedDiff();
  if (!diff) {
    p.outro(color.yellow(emptyMessage));
    return null;
  }
  return diff;
}

export interface DeslopFlowOptions {
  stagedDiff?: string;
  yes?: boolean;
  extraPrompt?: string;
}

async function getBaseDiff(): Promise<{ baseRef: string; diff: string }> {
  const defaultBranch = (await getDefaultBranch()) || "main";
  try {
    const diff = await getDiffBetween(defaultBranch, "HEAD");
    return { baseRef: defaultBranch, diff };
  } catch {
    return { baseRef: defaultBranch, diff: "" };
  }
}

async function createGitSnapshotRef(): Promise<string> {
  const snapshotRef = await git("stash create");
  if (!snapshotRef) {
    throw new Error("Failed to create git snapshot");
  }
  return snapshotRef;
}

async function runGitDifftool(snapshotRef: string): Promise<"ok" | "failed"> {
  return new Promise((resolve) => {
    const child = spawn("git", ["difftool", snapshotRef], {
      stdio: "inherit",
    });

    child.on("error", () => {
      resolve("failed");
    });

    child.on("exit", (code) => {
      resolve(code === 0 ? "ok" : "failed");
    });
  });
}

async function restoreGitSnapshot(snapshotRef: string): Promise<void> {
  await git(`restore --source ${snapshotRef} --worktree -- .`);
  try {
    await git(`restore --source ${snapshotRef}^2 --staged -- .`);
  } catch {
    await git(`restore --source ${snapshotRef} --staged -- .`);
  }
}

export async function maybeDeslopStagedChanges(
  options: DeslopFlowOptions,
): Promise<DeslopFlowResult> {
  const config = await getConfig();
  const autoDeslop = !!config.commit?.autoDeslop;

  let shouldDeslop = false;
  let extraPrompt = options.extraPrompt?.trim();

  if (options.yes) {
    shouldDeslop = autoDeslop;
  } else {
    // Combined prompt: user can answer y/n or type instructions directly
    const response = await p.text({
      message: `Deslop staged changes? ${color.dim("(y/n, or type instructions)")}`,
      placeholder: autoDeslop ? "Yes (press Enter) or type instructions" : "No (press Enter) or type y/instructions",
      initialValue: "",
    });

    if (p.isCancel(response)) {
      return "abort";
    }

    const input = (response ?? "").trim().toLowerCase();

    if (input === "" || input === "y" || input === "yes") {
      // Empty or explicit yes - deslop with no extra instructions
      shouldDeslop = input !== "" || autoDeslop;
    } else if (input === "n" || input === "no") {
      // Explicit no - skip deslop
      shouldDeslop = false;
    } else {
      // Any other input is treated as extra instructions
      shouldDeslop = true;
      extraPrompt = response?.trim();
    }
  }

  if (!shouldDeslop) {
    return "continue";
  }

  const stagedDiff = options.stagedDiff ?? (await getStagedDiff());
  if (!stagedDiff) {
    p.log.info(color.dim("No staged diff to deslop"));
    return "continue";
  }

  const { baseRef, diff: baseDiff } = await getBaseDiff();

  const statusBefore = await getStatus();
  const stagedFiles = statusBefore.staged;
  const notStagedFiles = Array.from(
    new Set([
      ...statusBefore.unstaged.filter((file) => !stagedFiles.includes(file)),
      ...statusBefore.untracked,
    ]),
  );

  const s = p.spinner();
  s.start("Deslopping staged changes");

  let deslopSession: Awaited<ReturnType<typeof runDeslopEdits>> | null = null;
  let snapshotRef: string | null = null;
  const fallbackSummary = "Deslop completed with minor cleanup adjustments.";
  let summary: string | null = null;

  try {
    snapshotRef = await createGitSnapshotRef();

    deslopSession = await runDeslopEdits({
      stagedDiff,
      baseDiff,
      baseRef,
      extraPrompt,
      stagedFiles,
      notStagedFiles,
    });

    summary = deslopSession.summary?.trim() || null;

    await stageFiles(stagedFiles);

    const updatedDiff = await getStagedDiff();
    const didChange = updatedDiff !== stagedDiff;

    if (!didChange) {
      s.stop("No deslop changes needed");
      p.log.step(summary || "No deslop changes were required.");
      return "continue";
    }

    s.stop("Deslop applied (review pending)");

    if (options.yes) {
      p.log.step(summary || fallbackSummary);
      return "updated";
    }

    const diffResult = snapshotRef
      ? await runGitDifftool(snapshotRef)
      : "failed";
    if (diffResult === "failed") {
      p.log.warn("git difftool failed. Review manually if needed.");
    }

    const action = await p.select({
      message: "Keep deslop changes?",
      options: [
        { value: "accept", label: "Accept and keep changes" },
        { value: "reject", label: "Reject and revert deslop changes" },
      ],
    });

    if (p.isCancel(action)) {
      if (snapshotRef) {
        await restoreGitSnapshot(snapshotRef);
      }
      return "abort";
    }

    if (action === "reject") {
      if (snapshotRef) {
        await restoreGitSnapshot(snapshotRef);
      }
      p.log.info(color.dim("Deslop changes reverted"));
      return "continue";
    }

    p.log.step(summary || fallbackSummary);
    return "updated";
  } catch (error: any) {
    s.stop("Deslop failed");
    if (snapshotRef) {
      try {
        await restoreGitSnapshot(snapshotRef);
      } catch {
        // Ignore cleanup errors
      }
    }
    p.cancel(error.message);
    return "abort";
  } finally {
    if (deslopSession) {
      try {
        await deslopSession.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
