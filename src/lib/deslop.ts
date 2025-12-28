import * as p from "@clack/prompts";
import color from "picocolors";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getConfig } from "./config";
import { runDeslopEdits } from "./opencode";
import { getDiffBetween, getStagedDiff, getStatus, stageFiles } from "../utils/git";

export type DeslopFlowResult = "continue" | "abort" | "updated";

export interface DeslopFlowOptions {
  stagedDiff?: string;
  yes?: boolean;
  extraPrompt?: string;
}

async function getBaseDiff(): Promise<{ baseRef: string; diff: string }> {
  try {
    const diff = await getDiffBetween("main", "HEAD");
    return { baseRef: "main", diff };
  } catch {
    try {
      const diff = await getDiffBetween("master", "HEAD");
      return { baseRef: "master", diff };
    } catch {
      return { baseRef: "main", diff: "" };
    }
  }
}

function resolveLocalCritiqueBin(): string | null {
  const startDir = dirname(fileURLToPath(import.meta.url));
  let currentDir = startDir;

  for (let i = 0; i < 6; i += 1) {
    const candidate = join(currentDir, "node_modules", ".bin", "critique");
    if (existsSync(candidate)) {
      return candidate;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

async function runCritiqueCommand(
  command: string,
  args: string[]
): Promise<"ok" | "missing" | "failed"> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit" });

    child.on("error", (error: any) => {
      if (error?.code === "ENOENT") {
        resolve("missing");
        return;
      }
      resolve("failed");
    });

    child.on("exit", (code) => {
      resolve(code === 0 ? "ok" : "failed");
    });
  });
}

async function reviewWithCritique(): Promise<"ok" | "missing" | "failed"> {
  const localBin = resolveLocalCritiqueBin();
  if (localBin) {
    const localResult = await runCritiqueCommand(localBin, ["--staged"]);
    if (localResult !== "missing") {
      return localResult;
    }
  }

  const pathResult = await runCritiqueCommand("critique", ["--staged"]);
  if (pathResult !== "missing") {
    return pathResult;
  }

  return runCritiqueCommand("bunx", ["critique", "--staged"]);
}

export async function maybeDeslopStagedChanges(
  options: DeslopFlowOptions
): Promise<DeslopFlowResult> {
  const config = await getConfig();
  const autoDeslop = !!config.commit?.autoDeslop;

  let shouldDeslop = false;

  if (options.yes) {
    shouldDeslop = autoDeslop;
  } else {
    const confirm = await p.confirm({
      message: "Deslop staged changes?",
      initialValue: autoDeslop,
    });

    if (p.isCancel(confirm)) {
      p.cancel("Aborted");
      return "abort";
    }

    shouldDeslop = !!confirm;
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

  let extraPrompt = options.extraPrompt?.trim();

  if (!options.yes && !extraPrompt) {
    const extra = await p.text({
      message: "Add any deslop exclusions or extra instructions? (optional)",
      placeholder: "e.g. Keep existing comments in src/api.ts",
      initialValue: "",
    });

    if (p.isCancel(extra)) {
      p.cancel("Aborted");
      return "abort";
    }

    const extraValue = typeof extra === "string" ? extra : "";
    extraPrompt = extraValue.trim() || undefined;
  }

  const statusBefore = await getStatus();
  const stagedFiles = statusBefore.staged;
  const overlapping = statusBefore.unstaged.filter((file) =>
    stagedFiles.includes(file)
  );

  if (overlapping.length > 0 && !options.yes) {
    p.log.warn(
      "Unstaged edits detected in staged files. Deslop will restage those files."
    );
    const overlapList = overlapping
      .map((file) => `  ${color.dim(file)}`)
      .join("\n");
    p.log.info(`Affected files:\n${overlapList}`);

    const proceed = await p.confirm({
      message: "Continue deslop and restage staged files?",
      initialValue: false,
    });

    if (p.isCancel(proceed) || !proceed) {
      p.cancel("Aborted");
      return "abort";
    }
  }

  const s = p.spinner();
  s.start("Deslopping staged changes");

  let deslopSession: Awaited<ReturnType<typeof runDeslopEdits>> | null = null;

  try {
    deslopSession = await runDeslopEdits({
      stagedDiff,
      baseDiff,
      baseRef,
      extraPrompt,
      stagedFiles,
    });

    await stageFiles(stagedFiles);
    const updatedDiff = await getStagedDiff();

    const summary = deslopSession.summary?.trim();
    const fallbackSummary = "Deslop completed with minor cleanup adjustments.";
    const didChange = !!updatedDiff && updatedDiff !== stagedDiff;

    if (!didChange) {
      s.stop("No deslop changes needed");
      if (summary) {
        p.log.step(summary);
      } else {
        p.log.step("No deslop changes were required.");
      }
      deslopSession.close();
      return "continue";
    }

    s.stop("Deslop applied (review pending)");

    if (options.yes) {
      p.log.step(summary || fallbackSummary);
      deslopSession.close();
      return "updated";
    }

    const reviewResult = await reviewWithCritique();
    if (reviewResult === "missing") {
      p.log.warn(
        `critique is not available. Install Bun and run: ${color.cyan("bunx critique")}`
      );
    } else if (reviewResult === "failed") {
      p.log.warn("critique exited with an error. Review manually if needed.");
    }

    const action = await p.select({
      message: "Keep deslop changes?",
      options: [
        { value: "accept", label: "Accept and keep changes" },
        { value: "reject", label: "Reject and revert deslop changes" },
      ],
    });

    if (p.isCancel(action)) {
      await deslopSession.revert();
      await stageFiles(stagedFiles);
      deslopSession.close();
      p.cancel("Aborted");
      return "abort";
    }

    if (action === "reject") {
      await deslopSession.revert();
      await stageFiles(stagedFiles);
      deslopSession.close();
      p.log.info(color.dim("Deslop changes reverted"));
      return "continue";
    }

    p.log.step(summary || fallbackSummary);
    deslopSession.close();
    return "updated";
  } catch (error: any) {
    s.stop("Deslop failed");
    if (deslopSession) {
      try {
        await deslopSession.revert();
        await stageFiles(stagedFiles);
      } catch {
        // Ignore cleanup errors
      }
      deslopSession.close();
    }
    p.cancel(error.message);
    return "abort";
  }
}
