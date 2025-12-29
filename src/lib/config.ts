/**
 * Configuration file management for oc
 *
 * Manages global ~/.oc and project-level .oc config directories.
 * Project config overrides global config.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { git } from "../utils/git";

const CONFIG_DIR = ".oc";
const COMMIT_CONFIG_FILE = "config.md";
const CHANGELOG_CONFIG_FILE = "changelog.md";
const JSON_CONFIG_FILE = "config.json";

// Global config directory in user's home
const GLOBAL_CONFIG_DIR = join(homedir(), ".oc");

/**
 * Check if a value is a plain object (for deep merge)
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge two config objects with override taking precedence.
 * Performs shallow merge on nested objects (one level deep).
 */
function mergeConfigs(base: OcConfig, override: Partial<OcConfig>): OcConfig {
  const result = { ...base };

  for (const key of Object.keys(override) as (keyof OcConfig)[]) {
    const baseValue = result[key];
    const overrideValue = override[key];

    if (overrideValue !== undefined) {
      if (isObject(baseValue) && isObject(overrideValue)) {
        // Shallow merge nested objects (one level)
        result[key] = { ...baseValue, ...overrideValue } as typeof baseValue;
      } else {
        result[key] = overrideValue as typeof baseValue;
      }
    }
  }

  return result;
}

/**
 * Ensure the global ~/.oc config directory exists
 */
function ensureGlobalConfigDir(): string {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
  }
  return GLOBAL_CONFIG_DIR;
}

/**
 * JSON config structure
 */
export interface OcConfig {
  commit?: {
    autoAccept?: boolean;
    autoStageAll?: boolean;
    autoCreateBranchOnDefault?: boolean;
    autoCreateBranchOnNonDefault?: boolean;
    forceNewBranchOnDefault?: boolean;
    autoDeslop?: boolean;
    branchModel?: string; // format: "provider/model"
    deslopModel?: string; // format: "provider/model"
    model?: string; // format: "provider/model"
  };
  changelog?: {
    autoSave?: boolean;
    outputFile?: string;
    model?: string; // format: "provider/model"
  };
  release?: {
    autoTag?: boolean;
    autoPush?: boolean;
    tagPrefix?: string;
  };
  general?: {
    confirmPrompts?: boolean;
    verbose?: boolean;
  };
}

const DEFAULT_JSON_CONFIG: OcConfig = {
  commit: {
    autoAccept: false,
    autoStageAll: false,
    autoCreateBranchOnDefault: true,
    autoCreateBranchOnNonDefault: false,
    forceNewBranchOnDefault: false,
    autoDeslop: false,
    branchModel: "opencode/gpt-5-nano",
    deslopModel: "opencode/gpt-5",
    model: "opencode/gpt-5-nano",
  },
  changelog: {
    autoSave: false,
    outputFile: "CHANGELOG.md",
    model: "opencode/claude-sonnet-4-5",
  },
  release: {
    autoTag: false,
    autoPush: false,
    tagPrefix: "v",
  },
  general: {
    confirmPrompts: true,
    verbose: false,
  },
};

const DEFAULT_COMMIT_CONFIG = `# Commit Message Guidelines

Generate commit messages following the Conventional Commits specification.

## Format

\`\`\`
<type>: <description>

[optional body]
\`\`\`

## Types

- \`feat\`: A new feature
- \`fix\`: A bug fix
- \`docs\`: Documentation only changes
- \`style\`: Changes that do not affect the meaning of the code
- \`refactor\`: A code change that neither fixes a bug nor adds a feature
- \`perf\`: A code change that improves performance
- \`test\`: Adding missing tests or correcting existing tests
- \`chore\`: Changes to the build process or auxiliary tools

## Rules

1. Use lowercase for the type
2. No scope (e.g., use \`feat:\` not \`feat(api):\`)
3. Use imperative mood in description ("add" not "added")
4. Keep the first line under 72 characters
5. Do not end the description with a period
6. Only return the commit message, no explanations or markdown formatting
`;

const DEFAULT_CHANGELOG_CONFIG = `# Changelog Generation Guidelines

Generate a changelog from the provided commits.

## Format

Use the "Keep a Changelog" format (https://keepachangelog.com/).

## Structure

\`\`\`markdown
## [Version] - YYYY-MM-DD

### Added
- New features

### Changed
- Changes in existing functionality

### Deprecated
- Soon-to-be removed features

### Removed
- Removed features

### Fixed
- Bug fixes

### Security
- Vulnerability fixes
\`\`\`

## Rules

1. Group commits by type (feat -> Added, fix -> Fixed, etc.)
2. Write in past tense ("Added" not "Add")
3. Include the commit hash in parentheses at the end of each entry
4. Keep descriptions concise but informative
5. Omit the version number and date - just use "Unreleased" as the heading
6. Skip empty sections
7. Only return the changelog content, no explanations
`;

/**
 * Get the git repository root directory
 */
async function getRepoRoot(): Promise<string> {
  const root = await git("rev-parse --show-toplevel");
  return root;
}

/**
 * Get a text config file with layered loading:
 * 1. Use project .oc/<fileName> if exists
 * 2. Otherwise use global ~/.oc/<fileName> (created if doesn't exist)
 */
async function getLayeredTextConfig(
  fileName: string,
  defaultContent: string,
): Promise<string> {
  // Check project config first
  try {
    const repoRoot = await getRepoRoot();
    const projectPath = join(repoRoot, CONFIG_DIR, fileName);

    if (existsSync(projectPath)) {
      return readFileSync(projectPath, "utf-8");
    }
  } catch {
    // Not in a git repo, use global
  }

  // Fall back to global config (create if doesn't exist)
  const globalDir = ensureGlobalConfigDir();
  const globalPath = join(globalDir, fileName);

  if (!existsSync(globalPath)) {
    writeFileSync(globalPath, defaultContent, "utf-8");
  }

  return readFileSync(globalPath, "utf-8");
}

/**
 * Get the commit config with layered loading:
 * 1. Use project .oc/config.md if exists
 * 2. Otherwise use global ~/.oc/config.md (created if doesn't exist)
 */
export async function getCommitConfig(): Promise<string> {
  return getLayeredTextConfig(COMMIT_CONFIG_FILE, DEFAULT_COMMIT_CONFIG);
}

/**
 * Get the changelog config with layered loading:
 * 1. Use project .oc/changelog.md if exists
 * 2. Otherwise use global ~/.oc/changelog.md (created if doesn't exist)
 */
export async function getChangelogConfig(): Promise<string> {
  return getLayeredTextConfig(CHANGELOG_CONFIG_FILE, DEFAULT_CHANGELOG_CONFIG);
}

/**
 * Check if config files exist
 */
export async function configExists(): Promise<boolean> {
  try {
    const repoRoot = await getRepoRoot();
    const configDir = join(repoRoot, CONFIG_DIR);
    return existsSync(join(configDir, COMMIT_CONFIG_FILE));
  } catch {
    return false;
  }
}

/**
 * Get the JSON config with layered loading:
 * 1. Start with defaults
 * 2. Merge global ~/.oc/config.json (created if doesn't exist)
 * 3. Merge project .oc/config.json (if exists, not created)
 */
export async function getConfig(): Promise<OcConfig> {
  // Start with defaults
  let config: OcConfig = { ...DEFAULT_JSON_CONFIG };

  // Load global config (create if doesn't exist)
  const globalDir = ensureGlobalConfigDir();
  const globalPath = join(globalDir, JSON_CONFIG_FILE);

  if (!existsSync(globalPath)) {
    writeFileSync(
      globalPath,
      JSON.stringify(DEFAULT_JSON_CONFIG, null, 2),
      "utf-8",
    );
  } else {
    try {
      const globalContent = readFileSync(globalPath, "utf-8");
      const globalConfig = JSON.parse(globalContent) as Partial<OcConfig>;
      config = mergeConfigs(config, globalConfig);
    } catch (error) {
      console.warn(
        `[oc] Warning: Could not parse global config at '${globalPath}'. Using defaults. Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Load project config (if exists, don't create)
  try {
    const repoRoot = await getRepoRoot();
    const projectPath = join(repoRoot, CONFIG_DIR, JSON_CONFIG_FILE);

    if (existsSync(projectPath)) {
      try {
        const projectContent = readFileSync(projectPath, "utf-8");
        const projectConfig = JSON.parse(projectContent) as Partial<OcConfig>;
        config = mergeConfigs(config, projectConfig);
      } catch (error) {
        console.warn(
          `[oc] Warning: Could not parse project config at '${projectPath}'. Using global config. Error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  } catch {
    // Not in a git repo, use global only
  }

  return config;
}
