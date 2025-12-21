#!/usr/bin/env node

import { Command } from "commander";
import { commitCommand } from "./commands/commit";
import { changelogCommand } from "./commands/changelog";
import { releaseCommand } from "./commands/release";
import { composeCommand } from "./commands/compose";
import { configCommand } from "./commands/config";

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
  .option("-m, --model <id>", "Override model (provider/model)")
  .action(async (message, options) => {
    await commitCommand({ message, ...options });
  });

// Config command
program
  .command("config")
  .alias("conf")
  .description("Configure AI models and settings")
  .action(async (options) => {
    await configCommand(options);
  });

// Changelog command
program
  .command("changelog")
  .alias("cl")
  .description("Generate changelog from commits")
  .option("-f, --from <ref>", "Starting commit/tag reference")
  .option("-t, --to <ref>", "Ending commit/tag reference", "HEAD")
  .option("-m, --model <id>", "Override model (provider/model)")
  .action(async (options) => {
    await changelogCommand(options);
  });

// Release command - generate changelog and commit it
program
  .command("release")
  .alias("rel")
  .description("Generate changelog, commit, and optionally tag")
  .option("-f, --from <ref>", "Starting commit/tag reference")
  .option("-v, --version <version>", "Version for the release")
  .option("-t, --tag", "Create a git tag for the release")
  .option("-p, --push", "Push to remote after tagging")
  .option("-y, --yes", "Skip confirmation prompts")
  .option("-m, --model <id>", "Override model (provider/model)")
  .action(async (options) => {
    await releaseCommand(options);
  });

// Compose command - organize changes into multiple commits
program
  .command("compose")
  .alias("cmp")
  .description("Organize changes into multiple logical commits using AI")
  .option("-a, --all", "Stage all changes before composing")
  .option("-y, --yes", "Skip confirmation prompts and apply all")
  .option("-i, --instructions <text>", "Additional instructions for AI")
  .option("-m, --model <id>", "Override model (provider/model)")
  .action(async (options) => {
    await composeCommand(options);
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
