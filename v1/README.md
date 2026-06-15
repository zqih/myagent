# Claude Code 1.0 Lean CLI

Runnable lean CLI for the 1.0 experiment. It is pure Node.js and does not use
OAuth, login, keychain, Bun, private packages, plugins, MCP, team mode, task
mode, plan mode, or the original Ink UI.

It talks to a Messages-compatible API with URL + key and supports a small code
tool loop:

- `read_file`
- `write_file`
- `edit_file`
- `grep`
- `bash`

Tools are restricted to the workspace root, which defaults to the current
directory. `bash` runs with `sh -lc` in that workspace.

## Run

```sh
export ANTHROPIC_API_KEY="your-key"
export ANTHROPIC_BASE_URL="https://api.anthropic.com" # optional
export ANTHROPIC_MODEL="claude-sonnet-4-5-20250929" # optional

node v1/claude-code-1.0.mjs
```

Single prompt mode:

```sh
node v1/claude-code-1.0.mjs -p "Read README.md and summarize it"
```

Pipe input:

```sh
printf "Run ls and tell me what files are here" | node v1/claude-code-1.0.mjs -p
```

Run against another workspace:

```sh
node v1/claude-code-1.0.mjs --cwd /path/to/project -p "Find TODOs"
```

Use a gateway:

```sh
node v1/claude-code-1.0.mjs \
  --base-url "https://your-gateway.example.com" \
  --model "claude-sonnet-4-5-20250929" \
  -p "Review this file"
```

## Options

- `-p`, `--print`: single prompt mode.
- `-m`, `--model <model>`: override `ANTHROPIC_MODEL`.
- `--base-url <url>`: override `ANTHROPIC_BASE_URL`.
- `--cwd <path>`: workspace root, defaults to current directory.
- `--max-tool-steps <n>`: max tool loop steps, defaults to `12`.
- `-h`, `--help`: show help.

## Environment

- `ANTHROPIC_API_KEY`: required.
- `ANTHROPIC_BASE_URL`: optional, defaults to `https://api.anthropic.com`.
- `ANTHROPIC_MODEL`: optional, defaults to `claude-sonnet-4-5-20250929`.
- `ANTHROPIC_MAX_TOKENS`: optional, defaults to `4096`.
- `CLAUDE_CODE_MAX_TOOL_OUTPUT`: optional, defaults to `20000` chars.
- `CLAUDE_CODE_MAX_TOOL_STEPS`: optional, defaults to `12`.
- `CLAUDE_CODE_SYSTEM_PROMPT`: optional lean system prompt override.
