/**
 * OpenCode AI client for generating commit messages and changelogs
 *
 * Integrates with opencode.ai SDK for AI inference
 */

import * as p from "@clack/prompts";
import {
	createOpencode,
	createOpencodeClient,
	type OpencodeClient,
} from "@opencode-ai/sdk";
import { exec } from "child_process";
import color from "picocolors";
import { promisify } from "util";
import {
	getChangelogConfig,
	getCommitConfig,
	getComposerConfig,
	resolveModelConfig,
	type ModelSelection,
} from "./config";

const execAsync = promisify(exec);

// Server state
let clientInstance: OpencodeClient | null = null;
let serverInstance: { close: () => void } | null = null;

export interface CommitGenerationOptions {
	diff: string;
	context?: string;
	model?: ModelSelection;
}

export interface ChangelogGenerationOptions {
	commits: Array<{ hash: string; message: string }>;
	diff?: string;
	fromRef: string;
	toRef: string;
	version?: string | null;
	model?: ModelSelection;
}

export interface UpdateChangelogOptions {
	newChangelog: string;
	existingChangelog: string;
	changelogPath: string;
	model?: ModelSelection;
}

export interface ComposerFileInput {
	path: string;
	additions: number;
	deletions: number;
	status: "added" | "modified" | "deleted" | "renamed";
	diff: string;
}

export interface ComposerDraftOutput {
	id: string;
	message: string;
	files: string[];
	reasoning?: string;
}

export interface ComposerAnalysisOutput {
	drafts: ComposerDraftOutput[];
	overall_reasoning?: string;
}

export interface ComposerOptions {
	files: ComposerFileInput[];
	instructions?: string;
	model?: ModelSelection;
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
export async function getClient(): Promise<OpencodeClient> {
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
			`Install it with: ${color.cyan("npm install -g opencode")} or ${color.cyan("brew install sst/tap/opencode")}`,
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
 * Get available models from OpenCode
 */
export async function getAvailableModels() {
	const client = await getClient();
	return client.config.providers();
}

/**
 * Extract text content from AI response parts
 */
function extractTextFromParts(parts: any[]): string {
	// First look for text parts
	const textParts = parts
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");

	if (textParts.trim()) {
		return textParts.trim();
	}

	// If no text parts, look for reasoning parts which some models (like o1) use for output
	const reasoningParts = parts
		.filter((part) => part.type === "reasoning")
		.map((part) => part.text || part.reasoning) // Handle potential different naming
		.join("");

	return reasoningParts.trim();
}

/**
 * Generate a commit message from a git diff using OpenCode AI
 */
export async function generateCommitMessage(
	options: CommitGenerationOptions,
): Promise<string> {
	const { diff, context } = options;

	const client = await getClient();
	const systemPrompt = await getCommitConfig();

	// Resolve model
	let modelSelection = options.model;
	if (!modelSelection) {
		const config = await resolveModelConfig();
		modelSelection = config.commit;
	}

	const model = {
		providerID: modelSelection.provider,
		modelID: modelSelection.model,
	};

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
			model: model,
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
	options: ChangelogGenerationOptions,
): Promise<string> {
	const { commits, fromRef, toRef, version } = options;

	const client = await getClient();
	const systemPrompt = await getChangelogConfig();

	// Resolve model
	let modelSelection = options.model;
	if (!modelSelection) {
		const config = await resolveModelConfig();
		modelSelection = config.changelog;
	}

	const model = {
		providerID: modelSelection.provider,
		modelID: modelSelection.model,
	};

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
			model: model,
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
	options: UpdateChangelogOptions,
): Promise<string> {
	const { newChangelog, existingChangelog, changelogPath } = options;

	const client = await getClient();

	// Resolve model
	let modelSelection = options.model;
	if (!modelSelection) {
		const config = await resolveModelConfig();
		modelSelection = config.changelog;
	}

	const model = {
		providerID: modelSelection.provider,
		modelID: modelSelection.model,
	};

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
			model: model,
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
 * Analyze changes and suggest how to group them into multiple commits
 */
export async function analyzeChangesForComposer(
	options: ComposerOptions,
): Promise<ComposerAnalysisOutput> {
	const { files, instructions } = options;

	const client = await getClient();
	const systemPrompt = await getComposerConfig();

	// Resolve model
	let modelSelection = options.model;
	if (!modelSelection) {
		const config = await resolveModelConfig();
		modelSelection = config.composer;
	}

	const model = {
		providerID: modelSelection.provider,
		modelID: modelSelection.model,
	};

	// Create a session for this analysis
	const session = await client.session.create({
		body: { title: "oc-composer" },
	});

	if (!session.data) {
		throw new Error("Failed to create session");
	}

	// Build file summary
	const fileSummary = files
		.map((f) => {
			const stats = `+${f.additions}/-${f.deletions}`;
			return `### ${f.path} (${f.status}, ${stats})\n\`\`\`diff\n${f.diff}\n\`\`\``;
		})
		.join("\n\n");

	// Build the prompt
	let prompt = `${systemPrompt}\n\n---\n\n## Files to analyze (${files.length} files):\n\n${fileSummary}`;

	if (instructions) {
		prompt += `\n\n## Additional Instructions:\n${instructions}`;
	}

	prompt += `\n\n---\n\nAnalyze these changes and return a JSON object grouping them into logical commits.`;

	// Send the prompt
	const result = await client.session.prompt({
		path: { id: session.data.id },
		body: {
			model: model,
			parts: [{ type: "text", text: prompt }],
		},
	});

	if (!result.data) {
		throw new Error("Failed to get AI response");
	}

	// Check for provider errors
	if (result.data.info?.error) {
		const error = result.data.info.error as any;
		// Handle specific provider errors
		if (error.code === "provider_auth_error" || error.type === "auth_error") {
			throw new Error(
				`Authentication failed for provider ${model.providerID}. Please check your credentials.`,
			);
		}
		throw new Error(
			`AI Provider Error: ${error.message || error.code || "Unknown error"}`,
		);
	}

	// Extract the response
	const responseText = extractTextFromParts(result.data.parts || []);

	// Clean up session
	await client.session.delete({ path: { id: session.data.id } });

	if (!responseText) {
		// Log detailed error information to help debug
		if (result.data.parts && result.data.parts.length > 0) {
			const partTypes = result.data.parts.map((p) => p.type).join(", ");
			p.log.error(
				`Received response with parts but no text content. Part types: ${partTypes}`,
			);
		} else {
			p.log.error("Received response with no parts");
		}

		// Include raw data snippet in the error for debugging
		throw new Error(
			"No analysis generated. The AI model returned an empty response.",
		);
	}

	// Parse the JSON response
	try {
		// Clean up markdown code blocks if present
		const cleanedResponse = responseText
			.replace(/^```json\n?/i, "")
			.replace(/^```\n?/, "")
			.replace(/\n?```$/, "")
			.trim();

		const parsed = JSON.parse(cleanedResponse) as ComposerAnalysisOutput;

		// Validate the structure
		if (!parsed.drafts || !Array.isArray(parsed.drafts)) {
			throw new Error("Invalid response structure: missing drafts array");
		}

		// Ensure all files are accounted for
		const allFilesInDrafts = new Set(parsed.drafts.flatMap((d) => d.files));
		const inputFiles = new Set(files.map((f) => f.path));

		for (const file of inputFiles) {
			if (!allFilesInDrafts.has(file)) {
				// Add missing files to the last draft or create a new one
				if (parsed.drafts.length > 0) {
					parsed.drafts[parsed.drafts.length - 1].files.push(file);
				} else {
					parsed.drafts.push({
						id: "1",
						message: "chore: miscellaneous changes",
						files: [file],
					});
				}
			}
		}

		return parsed;
	} catch (error: any) {
		throw new Error(`Failed to parse AI response: ${error.message}`);
	}
}

/**
 * Cleanup function to close the server if we spawned one
 */
export function cleanup(): void {
	serverInstance?.close();
	serverInstance = null;
	clientInstance = null;
}
