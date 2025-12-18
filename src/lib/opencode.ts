/**
 * OpenCode AI client for generating commit messages and changelogs
 *
 * Integrates with opencode.ai SDK for AI inference
 */

import * as p from "@clack/prompts";
import color from "picocolors";
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from "@opencode-ai/sdk";
import { exec } from "child_process";
import { promisify } from "util";
import { getCommitConfig, getChangelogConfig } from "./config";

const execAsync = promisify(exec);

// Models
type Model = {
  providerID: string;
  modelID: string;
};
const commitModelEnv = process.env["COMMIT_MODEL"];
let commitModel: Model;
if (!commitModelEnv) {
  // default
  commitModel = {
    providerID: "opencode",
    modelID: "gpt-5-nano",
  }
} else {
  const commitModelSplit = commitModelEnv.split("/");
  const commitProviderID = commitModelSplit[0];
  const commitModelID = commitModelSplit[1];
  if (!commitProviderID || !commitModelID) {
    throw new Error("COMMIT_MODEL must be in the form 'provider/model', e.g. 'opencode/gpt-5-nano', 'ollama/ministral-3:14b', etc.");
  }
  commitModel = {
    providerID: commitProviderID,
    modelID: commitModelID,
  }
}
export const COMMIT_MODEL = commitModel;

const changelogModelEnv = process.env["CHANGELOG_MODEL"];
let changelogModel: Model;
if (!changelogModelEnv) {
  // default
  changelogModel = {
    providerID: "opencode",
    modelID: "claude-sonnet-4-5",
  }
} else {
  const changelogModelSplit = changelogModelEnv.split("/");
  const changelogProviderID = changelogModelSplit[0];
  const changelogModelID = changelogModelSplit[1];
  if (!changelogProviderID || !changelogModelID) {
    throw new Error("CHANGELOG_MODEL must be in the form 'provider/model', e.g. 'opencode/gpt-5-nano', 'ollama/ministral-3:14b', etc.");
  }
  changelogModel = {
    providerID: changelogProviderID,
    modelID: changelogModelID,
  }
}
export const CHANGELOG_MODEL = changelogModel;

// Server state
let clientInstance: OpencodeClient | null = null;
let serverInstance: { close: () => void } | null = null;

export interface CommitGenerationOptions {
  diff: string;
  context?: string;
}

export interface ChangelogGenerationOptions {
  commits: Array<{ hash: string; message: string }>;
  diff?: string;
  fromRef: string;
  toRef: string;
  version?: string | null;
}

export interface UpdateChangelogOptions {
  newChangelog: string;
  existingChangelog: string;
  changelogPath: string;
}

/**
 * Check if opencode CLI is installed
 */
async function isOpencodeInstalled(): Promise<boolean> {
  try {
    await execAsync("which opencode");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if user is authenticated with opencode
 */
async function checkAuth(client: OpencodeClient): Promise<boolean> {
  try {
    const config = await client.config.get();
    return !!config;
  } catch {
    return false;
  }
}

/**
 * Get or create the OpenCode client
 * Tries to connect to existing server first, spawns new one if needed
 */
async function getClient(): Promise<OpencodeClient> {
  if (clientInstance) {
    return clientInstance;
  }

  // Try connecting to existing server first
  try {
    const client = createOpencodeClient({
      baseUrl: "http://localhost:4096",
    });
    // Test connection
    await client.config.get();
    clientInstance = client;
    return client;
  } catch {
    // No existing server, need to spawn one
  }

  // Check if opencode is installed
  if (!(await isOpencodeInstalled())) {
    p.log.error("OpenCode CLI is not installed");
    p.log.info(
      `Install it with: ${color.cyan("npm install -g opencode")} or ${color.cyan("brew install sst/tap/opencode")}`
    );
    process.exit(1);
  }

  // Spawn new server
  try {
    const opencode = await createOpencode({
      timeout: 10000,
    });

    clientInstance = opencode.client;
    serverInstance = opencode.server;

    // Check authentication
    if (!(await checkAuth(opencode.client))) {
      p.log.warn("Not authenticated with OpenCode");
      p.log.info(`Run ${color.cyan("opencode auth")} to authenticate`);
      process.exit(1);
    }

    // Clean up server on process exit
    process.on("exit", () => {
      serverInstance?.close();
    });
    process.on("SIGINT", () => {
      serverInstance?.close();
      process.exit(0);
    });
    process.on("SIGTERM", () => {
      serverInstance?.close();
      process.exit(0);
    });

    return opencode.client;
  } catch (error: any) {
    p.log.error(`Failed to start OpenCode server: ${error.message}`);
    p.log.info(`Make sure OpenCode is installed and configured correctly`);
    process.exit(1);
  }
}

/**
 * Extract text content from AI response parts
 */
function extractTextFromParts(parts: any[]): string {
  const textParts = parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");

  return textParts.trim();
}

/**
 * Generate a commit message from a git diff using OpenCode AI
 */
export async function generateCommitMessage(
  options: CommitGenerationOptions
): Promise<string> {
  const { diff, context } = options;

  const client = await getClient();
  const systemPrompt = await getCommitConfig();

  // Create a session for this commit
  const session = await client.session.create({
    body: { title: "oc-commit" },
  });

  if (!session.data) {
    throw new Error("Failed to create session");
  }

  // Build the prompt
  let prompt = `${systemPrompt}\n\n---\n\nGenerate a commit message for the following diff:\n\n\`\`\`diff\n${diff}\n\`\`\``;

  if (context) {
    prompt += `\n\nAdditional context: ${context}`;
  }

  // Send the prompt
  const result = await client.session.prompt({
    path: { id: session.data.id },
    body: {
      model: COMMIT_MODEL,
      parts: [{ type: "text", text: prompt }],
    },
  });

  if (!result.data) {
    throw new Error("Failed to get AI response");
  }

  // Extract the commit message from the response
  const message = extractTextFromParts(result.data.parts || []);

  // Clean up session
  await client.session.delete({ path: { id: session.data.id } });

  if (!message) {
    throw new Error("No commit message generated");
  }

  // Clean up the message (remove markdown code blocks if present)
  return message
    .replace(/^```[\s\S]*?\n/, "")
    .replace(/\n```$/, "")
    .trim();
}

/**
 * Generate a changelog from commits using OpenCode AI
 */
export async function generateChangelog(
  options: ChangelogGenerationOptions
): Promise<string> {
  const { commits, fromRef, toRef, version } = options;

  const client = await getClient();
  const systemPrompt = await getChangelogConfig();

  // Create a session for this changelog
  const session = await client.session.create({
    body: { title: "oc-changelog" },
  });

  if (!session.data) {
    throw new Error("Failed to create session");
  }

  // Build the commits list
  const commitsList = commits
    .map((c) => `- ${c.hash}: ${c.message}`)
    .join("\n");

  // Build version instruction
  let versionInstruction = "";
  if (version) {
    versionInstruction = `\n\nIMPORTANT: A version bump to ${version} was detected. Use "[${version}]" as the version header with today's date (format: YYYY-MM-DD), NOT "[Unreleased]".`;
  } else {
    versionInstruction = `\n\nUse "[Unreleased]" as the version header since no version bump was detected.`;
  }

  // Build the prompt
  const prompt = `${systemPrompt}\n\n---\n\nGenerate a changelog for the following commits (from ${fromRef} to ${toRef}):${versionInstruction}\n\n${commitsList}`;

  // Send the prompt
  const result = await client.session.prompt({
    path: { id: session.data.id },
    body: {
      model: CHANGELOG_MODEL,
      parts: [{ type: "text", text: prompt }],
    },
  });

  if (!result.data) {
    throw new Error("Failed to get AI response");
  }

  // Extract the changelog from the response
  const changelog = extractTextFromParts(result.data.parts || []);

  // Clean up session
  await client.session.delete({ path: { id: session.data.id } });

  if (!changelog) {
    throw new Error("No changelog generated");
  }

  return changelog.trim();
}

/**
 * Update an existing CHANGELOG.md file intelligently using AI
 * The AI will merge the new changelog content with existing content properly
 */
export async function updateChangelogFile(
  options: UpdateChangelogOptions
): Promise<string> {
  const { newChangelog, existingChangelog, changelogPath } = options;

  const client = await getClient();

  // Create a session for this update
  const session = await client.session.create({
    body: { title: "oc-changelog-update" },
  });

  if (!session.data) {
    throw new Error("Failed to create session");
  }

  const prompt = `You are updating a CHANGELOG.md file. Your task is to intelligently merge new changelog entries into the existing file.

## Rules:
1. Preserve the existing file structure and header
2. Add the new changelog entry in the correct position (newest entries at the top, after the header)
3. Do not duplicate entries - if similar entries exist, keep the most detailed version
4. Maintain consistent formatting with the existing file
5. Keep the "Keep a Changelog" format if that's what the file uses
6. If there's an existing [Unreleased] section, merge into it or replace it with the new content
7. Return ONLY the complete updated file content, no explanations

## Existing CHANGELOG.md:
\`\`\`markdown
${existingChangelog}
\`\`\`

## New changelog entry to add:
\`\`\`markdown
${newChangelog}
\`\`\`

Return the complete updated CHANGELOG.md content:`;

  // Send the prompt
  const result = await client.session.prompt({
    path: { id: session.data.id },
    body: {
      model: CHANGELOG_MODEL,
      parts: [{ type: "text", text: prompt }],
    },
  });

  if (!result.data) {
    throw new Error("Failed to get AI response");
  }

  // Extract the updated changelog
  let updatedChangelog = extractTextFromParts(result.data.parts || []);

  // Clean up session
  await client.session.delete({ path: { id: session.data.id } });

  if (!updatedChangelog) {
    throw new Error("No updated changelog generated");
  }

  // Clean up markdown code blocks if present
  updatedChangelog = updatedChangelog
    .replace(/^```markdown\n?/i, "")
    .replace(/^```\n?/, "")
    .replace(/\n?```$/, "")
    .trim();

  return updatedChangelog;
}

/**
 * Cleanup function to close the server if we spawned one
 */
export function cleanup(): void {
  serverInstance?.close();
  serverInstance = null;
  clientInstance = null;
}
