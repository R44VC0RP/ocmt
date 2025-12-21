/**
 * Type definitions for Commit Composer feature
 */

/**
 * Represents a single file change with its diff content
 */
export interface FileChange {
  /** File path relative to repo root */
  path: string;
  /** Number of lines added */
  additions: number;
  /** Number of lines deleted */
  deletions: number;
  /** File status */
  status: "added" | "modified" | "deleted" | "renamed";
  /** The actual diff content for this file */
  diff: string;
}

/**
 * A draft commit containing grouped file changes
 */
export interface DraftCommit {
  /** Unique identifier for this draft */
  id: string;
  /** Generated commit message */
  message: string;
  /** Files included in this commit */
  files: FileChange[];
}

/**
 * Result from AI analysis of changes
 */
export interface ComposerAnalysis {
  /** Grouped draft commits */
  drafts: DraftCommit[];
  /** Optional reasoning from AI about the grouping */
  reasoning?: string;
}

/**
 * Options for the compose command
 */
export interface ComposeOptions {
  /** Stage all changes before composing */
  all?: boolean;
  /** Skip confirmation prompts */
  yes?: boolean;
  /** Additional context/instructions for the AI */
  instructions?: string;
  /** Override model to use */
  model?: string;
}

/**
 * Action types for composer interaction
 */
export type ComposerAction =
  | "apply_all"
  | "apply_one"
  | "edit_message"
  | "move_files"
  | "merge_drafts"
  | "split_draft"
  | "regenerate"
  | "cancel";
