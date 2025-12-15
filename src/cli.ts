#!/usr/bin/env bun

import { Command } from "commander";
import { commitCommand } from "./commands/commit";
import { changelogCommand } from "./commands/changelog";

const program = new Command();

program
  .name("oc")
  .description("AI-powered git commit message generator using opencode.ai")
  .version("1.0.0");

// Default command (no subcommand) - runs commit flow
program
  .argument("[message]", "Optional commit message to use directly")
  .option("-a, --all", "Stage all changes before committing")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (message, options) => {
    await commitCommand({ message, ...options });
  });

// Changelog command
program
  .command("changelog")
  .alias("cl")
  .description("Generate changelog from commits (WIP)")
  .option("-f, --from <ref>", "Starting commit/tag reference")
  .option("-t, --to <ref>", "Ending commit/tag reference", "HEAD")
  .action(async (options) => {
    await changelogCommand(options);
  });

// Also support --changelog / -cl as flags on the main command
program
  .option("--changelog", "Generate changelog (alias for changelog command)")
  .option("-cl", "Generate changelog (shorthand)")
  .hook("preAction", async (thisCommand) => {
    const opts = thisCommand.opts();
    if (opts.changelog || opts.cl) {
      await changelogCommand({});
      process.exit(0);
    }
  });

program.parse();
