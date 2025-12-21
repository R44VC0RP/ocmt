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
export async function git(args: string, options?: { preserveWhitespace?: boolean }): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args}`);
    return options?.preserveWhitespace ? stdout : stdout.trim();
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
  // Preserve whitespace - leading spaces indicate index status
  const output = await git("status --porcelain", { preserveWhitespace: true });
  const lines = output.split("\n").filter((line) => line.length > 0);

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

export interface VersionBump {
  oldVersion: string | null;
  newVersion: string | null;
  file: string;
}

/**
 * Detect version bumps in package.json between two refs
 */
export async function detectVersionBump(
  from: string,
  to: string
): Promise<VersionBump | null> {
  try {
    // Check if package.json was modified (exact match for root package.json only)
    const changedFiles = await git(`diff --name-only ${from}..${to}`);
    const changedFilesList = changedFiles.split("\n").map(f => f.trim()).filter(Boolean);
    
    if (!changedFilesList.includes("package.json")) {
      return null;
    }

    // Get old version
    let oldVersion: string | null = null;
    try {
      const oldPackageJson = await git(`show ${from}:package.json`);
      const oldPkg = JSON.parse(oldPackageJson);
      oldVersion = oldPkg.version || null;
    } catch {
      // File might not exist in old ref
    }

    // Get new version
    let newVersion: string | null = null;
    try {
      const newPackageJson = await git(`show ${to}:package.json`);
      const newPkg = JSON.parse(newPackageJson);
      newVersion = newPkg.version || null;
    } catch {
      // File might not exist in new ref
    }

    // Only return if version actually changed
    if (oldVersion !== newVersion && newVersion) {
      return {
        oldVersion,
        newVersion,
        file: "package.json",
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get the current version from package.json in the working directory
 */
export async function getCurrentVersion(): Promise<string | null> {
  try {
    const repoRoot = await git("rev-parse --show-toplevel");
    const { readFileSync, existsSync } = await import("fs");
    const { join } = await import("path");

    const packageJsonPath = join(repoRoot, "package.json");

    if (!existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    return packageJson.version || null;
  } catch {
    return null;
  }
}

// =============================================================================
// Composer-related git utilities
// =============================================================================

export interface FileStats {
  path: string;
  additions: number;
  deletions: number;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface FileDiff {
  path: string;
  diff: string;
  stats: FileStats;
}

/**
 * Get the list of changed files with their stats (staged or unstaged)
 */
export async function getChangedFilesWithStats(
  staged: boolean = true
): Promise<FileStats[]> {
  const flag = staged ? "--cached" : "";

  // Get numstat for additions/deletions
  const numstatOutput = await git(`diff ${flag} --numstat`.trim());
  const nameStatusOutput = await git(`diff ${flag} --name-status`.trim());

  if (!numstatOutput && !nameStatusOutput) {
    return [];
  }

  const numstatLines = numstatOutput.split("\n").filter(Boolean);
  const nameStatusLines = nameStatusOutput.split("\n").filter(Boolean);

  const statsMap = new Map<string, FileStats>();

  // Parse numstat (additions, deletions, filename)
  for (const line of numstatLines) {
    const parts = line.split("\t");
    if (parts.length >= 3) {
      const additions = parts[0] === "-" ? 0 : parseInt(parts[0], 10);
      const deletions = parts[1] === "-" ? 0 : parseInt(parts[1], 10);
      const path = parts[2];

      statsMap.set(path, {
        path,
        additions,
        deletions,
        status: "modified", // Will be updated from name-status
      });
    }
  }

  // Parse name-status for file status
  for (const line of nameStatusLines) {
    const parts = line.split("\t");
    if (parts.length >= 2) {
      const statusChar = parts[0][0];
      // Handle renames: R100\told\tnew
      const path = parts.length === 3 ? parts[2] : parts[1];
      const oldPath = parts.length === 3 ? parts[1] : undefined;

      let status: FileStats["status"] = "modified";
      switch (statusChar) {
        case "A":
          status = "added";
          break;
        case "D":
          status = "deleted";
          break;
        case "R":
          status = "renamed";
          break;
        case "M":
        default:
          status = "modified";
          break;
      }

      // If renamed, we need to find by either old or new path
      const existing = statsMap.get(path) || statsMap.get(oldPath || "");
      if (existing) {
        existing.status = status;
        existing.path = path;
      } else {
        statsMap.set(path, {
          path,
          additions: 0,
          deletions: 0,
          status,
        });
      }
    }
  }

  return Array.from(statsMap.values());
}

/**
 * Get diff for a specific file (staged or unstaged)
 */
export async function getFileDiff(
  filePath: string,
  staged: boolean = true
): Promise<string> {
  const flag = staged ? "--cached" : "";
  try {
    return await git(`diff ${flag} -- "${filePath}"`.trim());
  } catch {
    return "";
  }
}

/**
 * Get diffs for all changed files with their stats
 */
export async function getAllFileDiffs(
  staged: boolean = true
): Promise<FileDiff[]> {
  const stats = await getChangedFilesWithStats(staged);
  const diffs: FileDiff[] = [];

  for (const stat of stats) {
    const diff = await getFileDiff(stat.path, staged);
    diffs.push({
      path: stat.path,
      diff,
      stats: stat,
    });
  }

  return diffs;
}

/**
 * Unstage specific files
 */
export async function unstageFiles(files: string[]): Promise<void> {
  if (files.length === 0) return;
  const escaped = files.map((f) => `"${f}"`).join(" ");
  await git(`reset HEAD ${escaped}`);
}

/**
 * Unstage all files
 */
export async function unstageAll(): Promise<void> {
  try {
    await git("reset HEAD");
  } catch {
    // Might fail if no commits yet, ignore
  }
}

/**
 * Get the content of a new/untracked file
 */
export async function getUntrackedFileContent(filePath: string): Promise<string> {
  try {
    const repoRoot = await git("rev-parse --show-toplevel");
    const { readFileSync } = await import("fs");
    const { join } = await import("path");

    const fullPath = join(repoRoot, filePath);
    return readFileSync(fullPath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Create a diff-like output for untracked files
 */
export async function createDiffForUntracked(filePath: string): Promise<string> {
  const content = await getUntrackedFileContent(filePath);
  if (!content) return "";

  const lines = content.split("\n");
  const diffLines = [
    `diff --git a/${filePath} b/${filePath}`,
    `new file mode 100644`,
    `--- /dev/null`,
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
  ];

  return diffLines.join("\n");
}