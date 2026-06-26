#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const usage = `Usage: npm run secrets:sync -- [options]

Creates or updates GitHub repository secrets from a dotenv file.

Options:
  --env-file <path>   Dotenv file to read. Defaults to .env, then .env.local.
  --repo <owner/repo> Repository to target. Defaults to the current gh repo.
  --dry-run           Print the gh commands that would be run.
  --help              Show this help.
`;

const color = (() => {
  const enabled = process.stdout.isTTY && !process.env.NO_COLOR;
  const wrap = (open, close) => (value) => (enabled ? `${open}${value}${close}` : value);

  return {
    bold: wrap('\x1b[1m', '\x1b[22m'),
    cyan: wrap('\x1b[36m', '\x1b[39m'),
    dim: wrap('\x1b[2m', '\x1b[22m'),
    green: wrap('\x1b[32m', '\x1b[39m'),
    magenta: wrap('\x1b[35m', '\x1b[39m'),
    red: wrap('\x1b[31m', '\x1b[39m'),
    yellow: wrap('\x1b[33m', '\x1b[39m'),
  };
})();

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  process.stdout.write(usage);
  process.exit(0);
}

const repoRoot = process.cwd();
const envFile = await resolveEnvFile(repoRoot, args.envFile);
const envText = await fs.readFile(envFile, 'utf8');
const secrets = parseDotenv(envText);
const entries = Object.entries(secrets);

if (entries.length === 0) {
  fail(`No secrets found in ${path.relative(repoRoot, envFile)}`);
}

if (args.dryRun) {
  printDryRun(entries, envFile, repoRoot, args.repo);
  process.exit(0);
}

for (const [name, value] of entries) {
  await setSecret(name, value, args.repo);
  process.stdout.write(`Set ${name}\n`);
}

function parseArgs(argv) {
  const parsed = {
    dryRun: false,
    envFile: null,
    help: false,
    repo: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else if (arg === '--dry-run') {
      parsed.dryRun = true;
    } else if (arg === '--env-file') {
      parsed.envFile = readValue(argv, ++i, '--env-file');
    } else if (arg.startsWith('--env-file=')) {
      parsed.envFile = arg.slice('--env-file='.length);
    } else if (arg === '--repo') {
      parsed.repo = readValue(argv, ++i, '--repo');
    } else if (arg.startsWith('--repo=')) {
      parsed.repo = arg.slice('--repo='.length);
    } else {
      fail(`Unknown argument: ${arg}\n\n${usage}`);
    }
  }

  return parsed;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    fail(`Missing value for ${flag}`);
  }
  return value;
}

async function resolveEnvFile(root, explicitPath) {
  if (explicitPath) {
    const fullPath = path.resolve(root, explicitPath);
    await assertReadable(fullPath, `Could not read ${explicitPath}`);
    return fullPath;
  }

  for (const candidate of ['.env', '.env.local']) {
    const fullPath = path.join(root, candidate);
    if (await exists(fullPath)) {
      return fullPath;
    }
  }

  fail('Could not find .env or .env.local. Pass --env-file <path> to choose a file.');
}

async function assertReadable(filePath, message) {
  try {
    await fs.access(filePath);
  } catch {
    fail(message);
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseDotenv(text) {
  const result = {};
  const lines = text.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const normalized = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line;
    const equalsIndex = findAssignment(normalized);
    if (equalsIndex === -1) {
      fail(`Invalid dotenv assignment on line ${index + 1}`);
    }

    const name = normalized.slice(0, equalsIndex).trim();
    const rawValue = normalized.slice(equalsIndex + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      fail(`Invalid secret name "${name}" on line ${index + 1}`);
    }

    result[name] = parseValue(rawValue);
  });

  return result;
}

function findAssignment(line) {
  let quote = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const previous = line[i - 1];

    if ((char === '"' || char === "'") && previous !== '\\') {
      quote = quote === char ? null : quote ?? char;
    } else if (char === '=' && quote === null) {
      return i;
    }
  }

  return -1;
}

function parseValue(rawValue) {
  if (!rawValue) return '';

  if (rawValue.startsWith('"')) {
    return parseQuoted(rawValue, '"');
  }

  if (rawValue.startsWith("'")) {
    return parseQuoted(rawValue, "'");
  }

  return stripInlineComment(rawValue).trim();
}

function parseQuoted(rawValue, quote) {
  let escaped = false;
  let value = '';

  for (let i = 1; i < rawValue.length; i++) {
    const char = rawValue[i];

    if (escaped) {
      value += quote === '"' ? unescapeDoubleQuoted(char) : char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return value;
    } else {
      value += char;
    }
  }

  fail('Unterminated quoted value in dotenv file');
}

function unescapeDoubleQuoted(char) {
  switch (char) {
    case 'n':
      return '\n';
    case 'r':
      return '\r';
    case 't':
      return '\t';
    default:
      return char;
  }
}

function stripInlineComment(value) {
  let escaped = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];

    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '#' && /\s/.test(value[i - 1] ?? '')) {
      return value.slice(0, i);
    }
  }

  return value;
}

function printDryRun(entries, envFile, root, repo) {
  const relativeEnvFile = path.relative(root, envFile);
  const secretLabel = entries.length === 1 ? 'secret' : 'secrets';

  process.stdout.write(`${color.bold(color.cyan('Dry run'))} ${color.dim('no GitHub secrets will be changed')}\n`);
  process.stdout.write(
    `${color.dim('Source')} ${color.yellow(relativeEnvFile)} ${color.dim('->')} ${color.green(`${entries.length} ${secretLabel}`)}\n\n`,
  );

  for (const [name] of entries) {
    const command = formatCommand('gh', buildGhArgs(name, repo));
    process.stdout.write(`${color.green('+')} ${command} ${color.dim('< hidden value via stdin')}\n`);
  }
}

function setSecret(name, value, repo) {
  return new Promise((resolve, reject) => {
    const ghArgs = buildGhArgs(name, repo);

    const child = spawn('gh', ghArgs, {
      stdio: ['pipe', 'inherit', 'inherit'],
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`gh secret set ${name} failed with exit code ${code}`));
      }
    });

    child.stdin.end(value);
  });
}

function buildGhArgs(name, repo) {
  const ghArgs = ['secret', 'set', name, '--app', 'actions'];
  if (repo) {
    ghArgs.push('--repo', repo);
  }
  return ghArgs;
}

function formatCommand(command, args) {
  return [color.bold(command), ...args.map(formatArg)].join(' ');
}

function formatArg(arg) {
  const escaped = shellEscape(arg);
  if (arg === 'secret' || arg === 'set') {
    return color.cyan(escaped);
  }
  if (arg.startsWith('--')) {
    return color.magenta(escaped);
  }
  return color.yellow(escaped);
}

function shellEscape(value) {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fail(message) {
  process.stderr.write(`${color.red(message)}\n`);
  process.exit(1);
}
