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
- **Customizable** - Edit `.oc/config.md` to customize commit message rules
- **Smart Composition** - Split large changes into logical atomic commits with `oc compose`
- **Model Selection** - Choose your preferred AI model for each task with `oc config`
- **Multiple aliases** - Use `oc`, `ocmt`, or `opencommit`

## Installation

### Prerequisites

- Node.js >= 18.0.0
- [OpenCode](https://opencode.ai) installed and authenticated

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

# npm
npm install -g ocmt

# pnpm
pnpm install -g ocmt

# yarn
yarn global add ocmt
```

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

### Compose Commits (Smart Split)

```bash
# Interactively split changes into multiple logical commits
oc compose

# Stage all changes first
oc compose -a
```

### Configure Models

```bash
# Interactive model configuration
oc config
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

On first run, ocmt creates a `.oc/` directory in your repository root with configuration files:

### `.oc/config.md` - Commit Message Rules

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

### `.oc/changelog.md` - Changelog Rules

Controls changelog generation format. Default uses [Keep a Changelog](https://keepachangelog.com/) format.

Edit these files to customize AI behavior for your project.

## Commands

| Command | Aliases | Description |
|---------|---------|-------------|
| `oc` | `ocmt`, `opencommit` | Generate commit message from staged changes |
| `oc compose` | | Split changes into logical atomic commits |
| `oc config` | | Configure AI models and settings |
| `oc changelog` | `oc cl` | Generate changelog from commits |

## Options

### Commit Options

| Option | Description |
|--------|-------------|
| `-a, --all` | Stage all changes before committing |
| `-y, --yes` | Skip confirmation prompts |
| `-m, --model <id>` | Override AI model (e.g. `anthropic/claude-3-5-sonnet`) |
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
3. **Generates message** - Sends diff to AI with your configured rules
4. **Confirms with you** - Shows the proposed message for approval/editing
5. **Commits** - Creates the commit with the final message

### Models Used

| Feature | Provider | Model |
|---------|----------|-------|
| Commit messages | opencode | gpt-5-nano |
| Changelogs | opencode | claude-sonnet-4-5 |

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
