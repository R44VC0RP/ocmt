import * as p from "@clack/prompts";
import color from "picocolors";
import { spawn } from "child_process";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { getConfig } from "./config";
import { generateDeslopPatch } from "./opencode";
import { git, getDiffBetween, getStagedDiff } from "../utils/git";

export type DeslopFlowResult = "continue" | "abort" | "updated";

export interface DeslopFlowOptions {
  stagedDiff?: string;
  yes?: boolean;
  extraPrompt?: string;
}

function createTempPatchPath(): string {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return join(tmpdir(), `oc-deslop-${stamp}.patch`);
}

function hasValidPatch(patch: string): boolean {
  return /^diff --git /m.test(patch) || /^---\s/m.test(patch);
}

async function applyPatch(patch: string, reverse: boolean = false): Promise<void> {
  const patchPath = createTempPatchPath();
  writeFileSync(patchPath, patch, "utf-8");
  try {
    const reverseFlag = reverse ? "--reverse " : "";
    await git(`apply --index --whitespace=nowarn ${reverseFlag}"${patchPath}"`);
  } finally {
    try {
      unlinkSync(patchPath);
    } catch {
      // Ignore cleanup errors
    }
  }
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

  const s = p.spinner();
  s.start("Deslopping staged changes");

  try {
    const result = await generateDeslopPatch({
      stagedDiff,
      baseDiff,
      baseRef,
      extraPrompt,
    });

    if (result.patch && hasValidPatch(result.patch)) {
      await applyPatch(result.patch);
      s.stop("Deslop applied (review pending)");
    } else {
      s.stop("No deslop changes needed");
    }

    const summary = result.summary?.trim();
    const fallbackSummary = "Deslop completed with minor cleanup adjustments.";

    if (!result.patch || !hasValidPatch(result.patch)) {
      if (summary) {
        p.log.step(summary);
      } else {
        p.log.step("No deslop changes were required.");
      }
      return "continue";
    }

    if (options.yes) {
      p.log.step(summary || fallbackSummary);
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
      await applyPatch(result.patch, true);
      p.cancel("Aborted");
      return "abort";
    }

    if (action === "reject") {
      await applyPatch(result.patch, true);
      p.log.info(color.dim("Deslop changes reverted"));
      return "continue";
    }

    p.log.step(summary || fallbackSummary);
    return "updated";
  } catch (error: any) {
    s.stop("Deslop failed");
    p.cancel(error.message);
    return "abort";
  }
}
