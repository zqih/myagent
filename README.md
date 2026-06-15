# myagent

`myagent` is a lean personal coding agent. Version `1.0` keeps the core coding
loop and removes the heavy Claude Code features that are not needed for daily
use: login/OAuth, keychain, Bun, private packages, plugins, MCP, team mode,
task mode, plan mode, web search, remote control, telemetry-heavy startup
paths, and the original Ink UI.

It is a pure Node.js CLI that talks to a Messages-compatible API with URL +
API key.

## Features

- Chat mode and single prompt mode.
- `ANTHROPIC_API_KEY` authentication only.
- Custom API gateway via `ANTHROPIC_BASE_URL` or `--base-url`.
- Custom model via `ANTHROPIC_MODEL` or `--model`.
- Small tool loop:
  - `read_file`
  - `write_file`
  - `edit_file`
  - `grep`
  - `bash`
- Workspace boundary with `--cwd`.
- Tool output truncation and max tool step limit.

## Run

```sh
export ANTHROPIC_API_KEY="your-key"
export ANTHROPIC_BASE_URL="https://api.anthropic.com" # optional
export ANTHROPIC_MODEL="claude-sonnet-4-5-20250929" # optional

node myagent.mjs --cwd /path/to/project
```

Single prompt:

```sh
node myagent.mjs --cwd /path/to/project -p "Read this repo and find the entrypoint"
```

Use a custom gateway:

```sh
node myagent.mjs \
  --base-url "https://your-gateway.example.com" \
  --model "claude-sonnet-4-5-20250929" \
  --cwd /path/to/project \
  -p "Review the recent changes"
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

## Safety Notes

Version `1.0` has basic safety only:

- File tools are restricted to `--cwd`.
- Tool calls are bounded by `--max-tool-steps`.
- Tool output is truncated.
- `edit_file` requires an exact and unique match.

It does not yet include command approval, write approval, sandbox isolation, or
network blocking.
