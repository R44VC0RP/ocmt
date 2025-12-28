# OpenCommit (ocmt)

AI-powered git commit message, changelog & documentation generator using [opencode.ai](https://opencode.ai)

```
┌   oc 
│
◆  Staged changes:
│    + src/index.ts
│    + src/utils/git.ts
│
●  Diff: 42 lines
│
◇  Commit message generated
│
◇  Proposed commit message:
│    "feat: add git status parsing utilities"
│
◆  What would you like to do?
│  ● Commit with this message
│  ○ Edit message
│  ○ Regenerate message
│  ○ Cancel
└
```

## Features

- **AI-powered commit messages** - Generates conventional commit messages from your staged changes
- **Changelog generation** - Create changelogs from your commit history
- **Interactive CLI** - Beautiful terminal UI with confirmation prompts
- **Customizable** - Edit `.oc/config.md` to customize commit message rules and models
- **Global + project config** - Set defaults in `~/.oc/`, override per-project
- **Multiple aliases** - Use `oc`, `ocmt`, or `opencommit`

## Installation

### Prerequisites

- Node.js >= 18.0.0
- [OpenCode](https://opencode.ai) installed and authenticated
- [Bun](https://bun.sh) (required for deslop review via critique)

#### Install OpenCode

```bash
# npm
npm install -g opencode

# or brew
brew install sst/tap/opencode
```

Then authenticate:

```bash
opencode auth
```

### Install ocmt

```bash
# bun (recommended)
bun install -g ocmt
# includes critique for deslop review

# npm
npm install -g ocmt

# pnpm
pnpm install -g ocmt

# yarn
yarn global add ocmt
```

Note: deslop review uses `critique`, which runs on Bun. If Bun isn't installed,
ocmt will skip the review step.

## Usage

### Generate Commit Message

```bash
# Interactive commit flow
oc

# Stage all changes first
oc -a

# Skip confirmation prompts
oc -y

# Stage all and skip prompts
oc -ay

# Use provided message directly (skips AI)
oc "feat: add new feature"
```

### Generate Changelog

```bash
# Interactive changelog generation
oc changelog

# Shorthand aliases
oc cl
oc --changelog
oc -cl

# Specify range
oc changelog --from v1.0.0 --to HEAD
oc changelog -f v1.0.0 -t v2.0.0
```

## Configuration

ocmt uses a layered configuration system with global defaults and project-level overrides.

### Config Locations

| Location | Purpose |
|----------|---------|
| `~/.oc/` | Global config (applies to all projects) |
| `<repo>/.oc/` | Project config (overrides global settings) |

On first run, ocmt creates the global `~/.oc/` directory with default configuration files. Project-level `.oc/` folders are optional and only used if they exist.

### `config.json` - Settings

Configure models, behavior, and preferences:

```json
{
  "commit": {
    "autoAccept": false,
    "autoStageAll": false,
    "autoCreateBranchOnDefault": true,
    "autoCreateBranchOnNonDefault": false,
    "forceNewBranchOnDefault": false,
    "autoDeslop": false,
    "branchModel": "opencode/gpt-5-nano",
    "deslopModel": "opencode/gpt-5",
    "model": "opencode/gpt-5-nano"
  },
  "changelog": {
    "autoSave": false,
    "outputFile": "CHANGELOG.md",
    "model": "opencode/claude-sonnet-4-5"
  },
  "release": {
    "autoTag": false,
    "autoPush": false,
    "tagPrefix": "v"
  },
  "general": {
    "confirmPrompts": true,
    "verbose": false
  }
}
```

#### Model Configuration

Models are specified in `provider/model` format:

```json
{
  "commit": {
    "model": "opencode/gpt-5-nano",
    "branchModel": "opencode/gpt-5-nano",
    "deslopModel": "opencode/gpt-5"
  },
  "changelog": {
    "model": "opencode/claude-sonnet-4-5"
  }
}
```

You can use any model supported by your provider. For example:
- `opencode/gpt-5-nano`
- `opencode/claude-sonnet-4-5`
- `github-copilot/gpt-4`

Reference [models.dev](https://models.dev/) for proper syntax supported by OpenCode

### `config.md` - Commit Message Rules

Controls how AI generates commit messages. Default uses [Conventional Commits](https://www.conventionalcommits.org/):

```markdown
# Commit Message Guidelines

## Types
- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `refactor`: Code change that neither fixes a bug nor adds a feature
...

## Rules
1. Use lowercase for the type
2. No scope (e.g., use `feat:` not `feat(api):`)
3. Use imperative mood ("add" not "added")
...
```

### `changelog.md` - Changelog Rules

Controls changelog generation format. Default uses [Keep a Changelog](https://keepachangelog.com/) format.

### Config Resolution

Settings are merged in this order (later overrides earlier):

```
1. Built-in defaults
      ↓
2. ~/.oc/config.json (global)
      ↓
3. <repo>/.oc/config.json (project)
```

For JSON config, individual fields are deep-merged. For markdown configs (`config.md`, `changelog.md`), the project file completely replaces the global file if it exists.

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `oc` | `ocmt`, `opencommit` | Generate commit message from staged changes |
| `oc changelog` | `oc cl` | Generate changelog from commits |

## Options

### Commit Options

| Option | Description |
|--------|-------------|
| `-a, --all` | Stage all changes before committing |
| `-y, --yes` | Skip confirmation prompts |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

### Changelog Options

| Option | Description |
|--------|-------------|
| `-f, --from <ref>` | Starting commit/tag reference |
| `-t, --to <ref>` | Ending commit/tag reference (default: `HEAD`) |

## How It Works

1. **Connects to OpenCode** - Tries to connect to an existing OpenCode server, or spawns a new one
2. **Analyzes your changes** - Reads the staged git diff
3. **Optional deslop** - Cleans AI slop from staged changes (if enabled). Review and accept/reject via `critique`.
4. **Optional branch** - Creates a new branch with an AI-generated name (if enabled)
5. **Generates message** - Sends diff to AI with your configured rules
6. **Confirms with you** - Shows the proposed message for approval/editing
7. **Commits** - Creates the commit with the final message

### Default Models

| Feature | Default Model |
|---------|---------------|
| Commit messages | `opencode/gpt-5-nano` |
| Branch names | `opencode/gpt-5-nano` |
| Deslop | `opencode/gpt-5` |
| Changelogs | `opencode/claude-sonnet-4-5` |

Models are configurable in `~/.oc/config.json` or `<repo>/.oc/config.json`. See [Configuration](#configuration) for details.

## Examples

### Basic Commit Flow

```bash
$ oc
┌   oc 
│
◆  Staged changes:
│    + src/utils/parser.ts
│    + src/index.ts
│
●  Diff: 127 lines
│
◇  Commit message generated
│
◇  Proposed commit message:
│    "feat: add expression parser with AST support"
│
◆  What would you like to do?
│  ● Commit with this message
└
```

### Changelog Generation

```bash
$ oc changelog
┌   changelog 
│
◇  Found releases and commits
│
◆  Select starting point for changelog:
│  ○ v1.0.0 (release)
│  ○ v0.9.0 (release)
│  ● abc1234 feat: add user authentication
│  ○ def5678 fix: resolve memory leak
└
```

## Troubleshooting

### "OpenCode CLI is not installed"

Install OpenCode first:

```bash
npm install -g opencode
# or
brew install sst/tap/opencode
```

### "Not authenticated with OpenCode"

Run authentication:

```bash
opencode auth
```

### "Not a git repository"

Make sure you're in a git repository:

```bash
git init
```

### No staged changes

Stage your changes first:

```bash
git add .
# or
oc -a  # stages all changes automatically
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`oc` 😉)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## Development

```bash
# Clone the repo
git clone https://github.com/yourusername/ocmt.git
cd ocmt

# Install dependencies
bun install

# Run in development mode
bun run dev

# Build for production
bun run build

# Type check
bun run typecheck
```

## License

MIT

## Links

- [OpenCode](https://opencode.ai) - AI coding assistant
- [OpenCode Docs](https://opencode.ai/docs) - Documentation
- [Conventional Commits](https://www.conventionalcommits.org/) - Commit message specification
- [Keep a Changelog](https://keepachangelog.com/) - Changelog format
