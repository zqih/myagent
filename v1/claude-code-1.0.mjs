#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { stdin as input, stdout as output } from 'node:process'
import readline from 'node:readline/promises'
import { promisify } from 'node:util'
import path from 'node:path'

const execFileAsync = promisify(execFile)

const API_KEY = process.env.ANTHROPIC_API_KEY
const BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com')
  .replace(/\/+$/, '')
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929'
const MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS || 4096)
const MAX_TOOL_OUTPUT = Number(process.env.CLAUDE_CODE_MAX_TOOL_OUTPUT || 20000)
const DEFAULT_MAX_TOOL_STEPS = Number(process.env.CLAUDE_CODE_MAX_TOOL_STEPS || 12)
const DEFAULT_CWD = process.cwd()

const SYSTEM_PROMPT =
  process.env.CLAUDE_CODE_SYSTEM_PROMPT ||
  [
    'You are Claude Code 1.0, a lean coding assistant.',
    'Use tools to inspect and modify files when needed.',
    'Keep answers concise. Mention changed files and verification commands.',
    'Ask before destructive broad changes. Prefer small, focused edits.',
  ].join(' ')

const TOOLS = [
  {
    name: 'read_file',
    description: 'Read a UTF-8 text file inside the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace.' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create or overwrite a UTF-8 text file inside the workspace.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace.' },
        content: { type: 'string', description: 'Complete file content.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace exact text in a UTF-8 text file. Fails if old_text is not found or is ambiguous.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path relative to the workspace.' },
        old_text: { type: 'string', description: 'Exact text to replace.' },
        new_text: { type: 'string', description: 'Replacement text.' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'grep',
    description: 'Search files with ripgrep when available, falling back to grep.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: { type: 'string', description: 'Search pattern.' },
        path: {
          type: 'string',
          description: 'Optional relative directory or file to search.',
        },
        glob: {
          type: 'string',
          description: 'Optional ripgrep glob, for example "*.js".',
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'bash',
    description: 'Run a shell command in the workspace and return stdout/stderr.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run with sh -lc.' },
        timeout_ms: {
          type: 'number',
          description: 'Optional timeout in milliseconds, default 30000.',
        },
      },
      required: ['command'],
    },
  },
]

function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = {
    print: false,
    prompt: '',
    baseUrl: BASE_URL,
    model: MODEL,
    cwd: DEFAULT_CWD,
    maxToolSteps: DEFAULT_MAX_TOOL_STEPS,
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-p' || arg === '--print') {
      opts.print = true
    } else if (arg === '-m' || arg === '--model') {
      opts.model = args[(i += 1)]
    } else if (arg === '--base-url') {
      opts.baseUrl = args[(i += 1)]?.replace(/\/+$/, '')
    } else if (arg === '--cwd') {
      opts.cwd = path.resolve(args[(i += 1)])
    } else if (arg === '--max-tool-steps') {
      opts.maxToolSteps = Number(args[(i += 1)])
    } else if (arg === '-h' || arg === '--help') {
      opts.help = true
    } else {
      opts.prompt = [opts.prompt, arg].filter(Boolean).join(' ')
    }
  }

  return opts
}

function printHelp() {
  output.write(`Claude Code 1.0 lean

Usage:
  node v1/claude-code-1.0.mjs [options] [prompt]

Options:
  -p, --print              Single prompt mode
  -m, --model <model>      Override ANTHROPIC_MODEL
  --base-url <url>         Override ANTHROPIC_BASE_URL
  --cwd <path>             Workspace root, default current directory
  --max-tool-steps <n>     Max tool loop steps, default ${DEFAULT_MAX_TOOL_STEPS}
  -h, --help               Show help

Environment:
  ANTHROPIC_API_KEY        Required
  ANTHROPIC_BASE_URL       Optional, default https://api.anthropic.com
  ANTHROPIC_MODEL          Optional, default ${MODEL}
`)
}

function requireConfig(opts) {
  if (!API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is required. Optional: set ANTHROPIC_BASE_URL and ANTHROPIC_MODEL.',
    )
  }
  if (!opts.baseUrl) throw new Error('Base URL is empty.')
  if (!opts.model) throw new Error('Model is empty.')
  if (!Number.isFinite(opts.maxToolSteps) || opts.maxToolSteps < 0) {
    throw new Error('--max-tool-steps must be a non-negative number.')
  }
}

function truncate(text, max = MAX_TOOL_OUTPUT) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n\n[truncated ${text.length - max} chars]`
}

function textFromContent(content) {
  return content
    .filter(part => part?.type === 'text')
    .map(part => part.text)
    .join('')
}

function resolveWorkspacePath(cwd, userPath = '.') {
  const resolved = path.resolve(cwd, userPath)
  const relative = path.relative(cwd, resolved)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return resolved
  }
  throw new Error(`Path escapes workspace: ${userPath}`)
}

async function readStdin() {
  const chunks = []
  for await (const chunk of input) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function sendMessage(messages, opts) {
  const response = await fetch(`${opts.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`API request failed: ${response.status} ${body}`)
  }

  return response.json()
}

async function runReadFile(args, opts) {
  const filePath = resolveWorkspacePath(opts.cwd, args.path)
  const content = await fs.readFile(filePath, 'utf8')
  return truncate(content)
}

async function runWriteFile(args, opts) {
  const filePath = resolveWorkspacePath(opts.cwd, args.path)
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, args.content, 'utf8')
  return `Wrote ${Buffer.byteLength(args.content, 'utf8')} bytes to ${args.path}`
}

async function runEditFile(args, opts) {
  const filePath = resolveWorkspacePath(opts.cwd, args.path)
  const content = await fs.readFile(filePath, 'utf8')
  const first = content.indexOf(args.old_text)
  if (first === -1) throw new Error('old_text was not found.')
  if (content.indexOf(args.old_text, first + args.old_text.length) !== -1) {
    throw new Error('old_text appears more than once. Provide a larger unique block.')
  }
  const next =
    content.slice(0, first) + args.new_text + content.slice(first + args.old_text.length)
  await fs.writeFile(filePath, next, 'utf8')
  return `Edited ${args.path}`
}

async function runGrep(args, opts) {
  const searchPath = resolveWorkspacePath(opts.cwd, args.path || '.')
  const rgArgs = ['--line-number', '--color', 'never']
  if (args.glob) rgArgs.push('--glob', args.glob)
  rgArgs.push(args.pattern, searchPath)

  try {
    const { stdout, stderr } = await execFileAsync('rg', rgArgs, {
      cwd: opts.cwd,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
    })
    return truncate([stdout, stderr].filter(Boolean).join('\n') || 'No matches.')
  } catch (error) {
    if (error.code === 1) return 'No matches.'
    if (error.code !== 'ENOENT') {
      return truncate([error.stdout, error.stderr, error.message].filter(Boolean).join('\n'))
    }
  }

  const grepArgs = ['-RIn', args.pattern, searchPath]
  const { stdout, stderr } = await execFileAsync('grep', grepArgs, {
    cwd: opts.cwd,
    timeout: 30000,
    maxBuffer: 10 * 1024 * 1024,
  }).catch(error => {
    if (error.code === 1) return { stdout: 'No matches.', stderr: '' }
    throw error
  })
  return truncate([stdout, stderr].filter(Boolean).join('\n'))
}

async function runBash(args, opts) {
  const timeout = Number(args.timeout_ms || 30000)
  const { stdout, stderr } = await execFileAsync('sh', ['-lc', args.command], {
    cwd: opts.cwd,
    timeout,
    maxBuffer: 10 * 1024 * 1024,
    env: process.env,
  }).catch(error => ({
    stdout: error.stdout || '',
    stderr: [error.stderr, error.message].filter(Boolean).join('\n'),
  }))
  return truncate([stdout, stderr].filter(Boolean).join('\n') || '(no output)')
}

async function runTool(toolUse, opts) {
  try {
    const args = toolUse.input || {}
    let result
    if (toolUse.name === 'read_file') result = await runReadFile(args, opts)
    else if (toolUse.name === 'write_file') result = await runWriteFile(args, opts)
    else if (toolUse.name === 'edit_file') result = await runEditFile(args, opts)
    else if (toolUse.name === 'grep') result = await runGrep(args, opts)
    else if (toolUse.name === 'bash') result = await runBash(args, opts)
    else throw new Error(`Unknown tool: ${toolUse.name}`)
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: result,
    }
  } catch (error) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      is_error: true,
      content: error.message,
    }
  }
}

async function runConversation(messages, opts) {
  for (let step = 0; step <= opts.maxToolSteps; step += 1) {
    const result = await sendMessage(messages, opts)
    messages.push({ role: 'assistant', content: result.content })

    const toolUses = result.content.filter(part => part.type === 'tool_use')
    if (toolUses.length === 0) {
      return textFromContent(result.content)
    }

    if (step === opts.maxToolSteps) {
      return `Stopped after ${opts.maxToolSteps} tool steps.`
    }

    for (const toolUse of toolUses) {
      output.write(`[tool] ${toolUse.name}\n`)
    }
    const toolResults = []
    for (const toolUse of toolUses) {
      toolResults.push(await runTool(toolUse, opts))
    }
    messages.push({ role: 'user', content: toolResults })
  }
  return 'Stopped.'
}

async function printOnce(prompt, opts) {
  const messages = [{ role: 'user', content: prompt }]
  const answer = await runConversation(messages, opts)
  output.write(`${answer}\n`)
}

async function repl(opts) {
  const rl = readline.createInterface({ input, output })
  const messages = []
  output.write(`Claude Code 1.0 lean (${opts.model})\n`)
  output.write(`Workspace: ${opts.cwd}\n`)
  output.write('Type /exit to quit.\n\n')

  while (true) {
    const prompt = await rl.question('> ')
    if (!prompt.trim()) continue
    if (['/exit', '/quit'].includes(prompt.trim())) break

    messages.push({ role: 'user', content: prompt })
    const answer = await runConversation(messages, opts)
    output.write(`${answer}\n\n`)
  }

  rl.close()
}

async function main() {
  const opts = parseArgs(process.argv)
  if (opts.help) {
    printHelp()
    return
  }

  requireConfig(opts)
  await fs.access(opts.cwd)

  if (opts.print || opts.prompt) {
    await printOnce(opts.prompt || (await readStdin()), opts)
    return
  }
  await repl(opts)
}

main().catch(error => {
  console.error(error.message)
  process.exit(1)
})
