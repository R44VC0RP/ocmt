/**
 * Configuration file management for oc
 *
 * Manages .oc/config.md and .oc/changelog.md in the repo root
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { git } from "../utils/git";

const CONFIG_DIR = ".oc";
const COMMIT_CONFIG_FILE = "config.md";
const CHANGELOG_CONFIG_FILE = "changelog.md";
const COMPOSER_CONFIG_FILE = "compose.md";
const MODEL_CONFIG_FILE = "models.json";

export interface ModelSelection {
  provider: string;
  model: string;
}

export interface ModelConfig {
  commit?: ModelSelection;
  changelog?: ModelSelection;
  composer?: ModelSelection;
}

const DEFAULT_MODELS: Required<ModelConfig> = {
  commit: { provider: "opencode", model: "gpt-5-nano" },
  changelog: { provider: "opencode", model: "claude-sonnet-4-5" },
  composer: { provider: "opencode", model: "claude-sonnet-4-5" },
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

const DEFAULT_COMPOSER_CONFIG = `# Commit Composer Guidelines

You are analyzing git changes to organize them into multiple logical commits.

## Task

Analyze the provided file diffs and group them into logical, atomic commits.
Each group should represent a single, coherent change that could be committed independently.

## Grouping Principles

1. **Feature Cohesion**: Group files that implement the same feature together
2. **Type Separation**: Separate different types of changes (features, fixes, refactors, docs, tests)
3. **Dependency Order**: Order commits so dependencies come before dependents
4. **Atomic Changes**: Each commit should be self-contained and not break the build
5. **Related Files**: Keep related files together (e.g., component + styles + tests)

## Output Format

Return a JSON object with this exact structure:

\`\`\`json
{
  "drafts": [
    {
      "id": "1",
      "message": "feat: add user authentication",
      "files": ["src/auth/login.ts", "src/auth/middleware.ts"],
      "reasoning": "These files implement the authentication feature"
    },
    {
      "id": "2",
      "message": "docs: update API documentation",
      "files": ["README.md", "docs/api.md"],
      "reasoning": "Documentation updates should be separate from code changes"
    }
  ],
  "overall_reasoning": "Brief explanation of the overall grouping strategy"
}
\`\`\`

## Commit Message Rules

1. Use Conventional Commits format: \`<type>: <description>\`
2. Types: feat, fix, docs, style, refactor, perf, test, chore
3. Use imperative mood ("add" not "added")
4. Keep under 72 characters
5. Be specific about what changed

## Important

- Every file from the input MUST appear in exactly one draft
- Order drafts by logical dependency (what should be committed first)
- Prefer fewer, more meaningful commits over many tiny ones
- Return ONLY the JSON object, no markdown code blocks or explanations
`;

/**
 * Get the git repository root directory
 */
async function getRepoRoot(): Promise<string> {
  const root = await git("rev-parse --show-toplevel");
  return root;
}

/**
 * Ensure the .oc config directory exists
 */
async function ensureConfigDir(): Promise<string> {
  const repoRoot = await getRepoRoot();
  const configDir = join(repoRoot, CONFIG_DIR);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  return configDir;
}

/**
 * Parse a model string "provider/model" into a ModelSelection object
 */
export function parseModelString(modelString?: string): ModelSelection | undefined {
  if (!modelString) return undefined;
  const parts = modelString.split("/");
  if (parts.length < 2) return undefined;
  return {
    provider: parts[0],
    model: parts.slice(1).join("/"), // Handle models with slashes if any
  };
}

/**
 * Get the global model config path
 */
export function getGlobalModelConfigPath(): string {
  return join(homedir(), ".oc", MODEL_CONFIG_FILE);
}

/**
 * Get the repo model config path
 */
export async function getRepoModelConfigPath(): Promise<string> {
  const configDir = await ensureConfigDir();
  return join(configDir, MODEL_CONFIG_FILE);
}

/**
 * Read model config from a file
 */
export function readModelConfig(path: string): ModelConfig {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Write model config to a file
 */
export function writeModelConfig(path: string, config: ModelConfig): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * Resolve the effective model configuration
 */
export async function resolveModelConfig(
  flags: Partial<ModelConfig> = {}
): Promise<Required<ModelConfig>> {
  // 1. Defaults
  const config = { ...DEFAULT_MODELS };

  // 2. Global Config
  const globalPath = getGlobalModelConfigPath();
  const globalConfig = readModelConfig(globalPath);
  if (globalConfig.commit) config.commit = globalConfig.commit;
  if (globalConfig.changelog) config.changelog = globalConfig.changelog;
  if (globalConfig.composer) config.composer = globalConfig.composer;

  // 3. Repo Config
  try {
    const repoRoot = await getRepoRoot();
    // Only try to read repo config if we are in a git repo
    if (repoRoot) {
      const repoPath = join(repoRoot, CONFIG_DIR, MODEL_CONFIG_FILE);
      const repoConfig = readModelConfig(repoPath);
      if (repoConfig.commit) config.commit = repoConfig.commit;
      if (repoConfig.changelog) config.changelog = repoConfig.changelog;
      if (repoConfig.composer) config.composer = repoConfig.composer;
    }
  } catch {
    // Ignore errors resolving repo root
  }

  // 4. Flags (overrides)
  if (flags.commit) config.commit = flags.commit;
  if (flags.changelog) config.changelog = flags.changelog;
  if (flags.composer) config.composer = flags.composer;

  return config;
}

/**
 * Get the commit config (creates default if doesn't exist)
 */
export async function getCommitConfig(): Promise<string> {
  const configDir = await ensureConfigDir();
  const configPath = join(configDir, COMMIT_CONFIG_FILE);

  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_COMMIT_CONFIG, "utf-8");
  }

  return readFileSync(configPath, "utf-8");
}

/**
 * Get the changelog config (creates default if doesn't exist)
 */
export async function getChangelogConfig(): Promise<string> {
  const configDir = await ensureConfigDir();
  const configPath = join(configDir, CHANGELOG_CONFIG_FILE);

  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_CHANGELOG_CONFIG, "utf-8");
  }

  return readFileSync(configPath, "utf-8");
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
 * Get the composer config (creates default if doesn't exist)
 */
export async function getComposerConfig(): Promise<string> {
  const configDir = await ensureConfigDir();
  const configPath = join(configDir, COMPOSER_CONFIG_FILE);

  if (!existsSync(configPath)) {
    writeFileSync(configPath, DEFAULT_COMPOSER_CONFIG, "utf-8");
  }

  return readFileSync(configPath, "utf-8");
}
