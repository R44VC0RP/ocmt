import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/**
 * Execute a git command and return the output
 */
export async function git(args: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args}`);
    return stdout.trim();
  } catch (error: any) {
    throw new Error(`Git command failed: ${error.message}`);
  }
}

/**
 * Check if current directory is a git repository
 */
export async function isGitRepo(): Promise<boolean> {
  try {
    await git("rev-parse --is-inside-work-tree");
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the current git status
 */
export async function getStatus(): Promise<GitStatus> {
  const output = await git("status --porcelain");
  const lines = output.split("\n").filter(Boolean);

  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of lines) {
    const indexStatus = line[0];
    const workTreeStatus = line[1];
    const file = line.slice(3);

    if (indexStatus === "?") {
      untracked.push(file);
    } else if (indexStatus !== " ") {
      staged.push(file);
    }

    if (workTreeStatus !== " " && workTreeStatus !== "?") {
      unstaged.push(file);
    }
  }

  return { staged, unstaged, untracked };
}

/**
 * Get staged diff
 */
export async function getStagedDiff(): Promise<string> {
  return git("diff --cached");
}

/**
 * Get unstaged diff
 */
export async function getUnstagedDiff(): Promise<string> {
  return git("diff");
}

/**
 * Stage all changes
 */
export async function stageAll(): Promise<void> {
  await git("add -A");
}

/**
 * Stage specific files
 */
export async function stageFiles(files: string[]): Promise<void> {
  if (files.length === 0) return;
  const escaped = files.map((f) => `"${f}"`).join(" ");
  await git(`add ${escaped}`);
}

/**
 * Create a commit with the given message
 */
export async function commit(message: string): Promise<string> {
  return git(`commit -m "${message.replace(/"/g, '\\"')}"`);
}

/**
 * Get commit log
 */
export async function getLog(
  options: { from?: string; to?: string; limit?: number } = {}
): Promise<string> {
  const { from, to = "HEAD", limit } = options;
  let cmd = "log --oneline";

  if (limit) {
    cmd += ` -n ${limit}`;
  }

  if (from) {
    cmd += ` ${from}..${to}`;
  }

  return git(cmd);
}

/**
 * Get list of tags
 */
export async function getTags(): Promise<string[]> {
  try {
    const output = await git("tag --sort=-creatordate");
    return output.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Get list of releases from git tags
 */
export async function getReleases(): Promise<string[]> {
  const tags = await getTags();
  // Filter to only version-like tags (v1.0.0, 1.0.0, etc.)
  return tags.filter((tag) => /^v?\d+\.\d+\.\d+/.test(tag));
}

/**
 * Get the diff between two refs
 */
export async function getDiffBetween(from: string, to: string): Promise<string> {
  return git(`diff ${from}..${to}`);
}

/**
 * Get commits between two refs
 */
export async function getCommitsBetween(
  from: string,
  to: string
): Promise<Array<{ hash: string; message: string }>> {
  const output = await git(`log --oneline ${from}..${to}`);
  const lines = output.split("\n").filter(Boolean);

  return lines.map((line) => {
    const [hash, ...messageParts] = line.split(" ");
    return { hash, message: messageParts.join(" ") };
  });
}
