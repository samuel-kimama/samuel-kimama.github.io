import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import tty from 'node:tty';

const repoRoot = process.cwd();
const repoName = path.basename(repoRoot);
const {
  ignorePaths,
  extraRootConfigFiles,
  extraWatchPrefixes,
  buildScript,
  buildCommand,
  buildEnvOverrides,
} = (() => {
  const ignores = [];
  const extraRoot = [];
  const extraPrefixes = [];
  const rest = [];
  const envOverrides = {};
  let bscript = null;
  const collectList = (raw) =>
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  const matchFlag = (arg, flag) => {
    if (arg === flag) return { present: true, value: null };
    const prefix = `${flag}=`;
    if (arg.startsWith(prefix)) return { present: true, value: arg.slice(prefix.length) };
    return { present: false, value: null };
  };
  const readFlag = (arg, flag, i) => {
    const m = matchFlag(arg, flag);
    if (!m.present) return null;
    if (m.value !== null) return { value: m.value, nextIndex: i };
    if (i + 1 >= process.argv.length) return null;
    return { value: process.argv[i + 1], nextIndex: i + 1 };
  };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    let flag;
    if ((flag = readFlag(arg, '--ignore-paths', i))) {
      ignores.push(...collectList(flag.value));
      i = flag.nextIndex;
    } else if ((flag = readFlag(arg, '--root-config', i))) {
      extraRoot.push(...collectList(flag.value));
      i = flag.nextIndex;
    } else if ((flag = readFlag(arg, '--watch-prefix', i))) {
      extraPrefixes.push(...collectList(flag.value));
      i = flag.nextIndex;
    } else if ((flag = readFlag(arg, '--build-script', i))) {
      bscript = path.resolve(flag.value);
      i = flag.nextIndex;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*=.*/.test(arg)) {
      const eq = arg.indexOf('=');
      const rawKey = arg.slice(0, eq);
      const value = arg.slice(eq + 1);
      const key = rawKey === 'etch_dev_tools' ? 'ETCH_DEV_TOOLS' : rawKey;
      envOverrides[key] = value;
    } else {
      rest.push(arg);
    }
  }
  if (!bscript) {
    for (const c of [
      'scripts/esbuild-build.mjs',
      'scripts/esbuild.mjs',
      'scripts/build.mjs',
      'esbuild.config.mjs',
    ]) {
      const full = path.join(repoRoot, c);
      if (fsSync.existsSync(full)) {
        bscript = full;
        break;
      }
    }
  }
  return {
    ignorePaths: ignores,
    extraRootConfigFiles: extraRoot,
    extraWatchPrefixes: extraPrefixes.map((p) => (p.endsWith('/') ? p : `${p}/`)),
    buildScript: bscript,
    buildCommand:
      rest.length > 0
        ? rest
        : bscript
          ? [process.execPath, bscript]
          : [detectPackageManager(repoRoot), 'run', 'build'],
    buildEnvOverrides: envOverrides,
  };
})();

function detectPackageManager(root) {
  const has = (f) => fsSync.existsSync(path.join(root, f));
  if (has('pnpm-workspace.yaml') || has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  if (has('bun.lockb') || has('bun.lock')) return 'bun';
  return 'npm';
}
const debounceMs = Number.parseInt(process.env.BUILD_DASHBOARD_DEBOUNCE ?? '150', 10);
const fallbackPollMs = Number.parseInt(process.env.BUILD_DASHBOARD_INTERVAL ?? '1000', 10);
const watchmanName = `build-dashboard-${process.pid}`;
const latestBuildFlashMs = 4_000;

const statusColors = {
  ok: '\x1b[32m',
  building: '\x1b[33m',
  error: '\x1b[31m',
};

const spinnerFrames = ['-', '\\', '|', '/'];
const rootConfigFiles = new Set([
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package-lock.json',
  'tsconfig.json',
  'vitest.config.js',
  'playwright.config.js',
  'web-ext-config.mjs',
  'release.config.mjs',
  'commitlint.config.mjs',
  'lefthook.yml',
  'biome.json',
  'amo-metadata.json',
  'astro.config.mjs',
  'astro.config.ts',
  'astro.config.js',
  'vercel.json',
  '.nvmrc',
  '.env.local',
  ...extraRootConfigFiles,
]);

const state = {
  status: 'ok',
  version: '',
  message: 'Initializing…',
  lastUpdateAt: '',
  history: [],
  lastErrorLog: '',
  showErrorPane: true,
  buildRunning: false,
  stopRequested: false,
  spinnerIndex: 0,
  backend: 'watchman',
  branch: '',
  worktree: '',
  defineVars: [],
  builtSha: '',
};

let repoMeta = null;
let debounceTimer = null;
let spinnerTimer = null;
let gitMetaTimer = null;
let elapsedTimer = null;
let pendingFiles = new Set();
let watchmanSocket = null;
let watchmanStdoutBuffer = '';
const watchmanPendingResponses = [];
let watchmanWatchRoot = '';
let watchmanRelativePath = '';
let pollTimer = null;
let lastFallbackStatusSnapshot = '';
let inputStream = null;
let inputFd = null;

const _stripAnsiRe = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

await main();

async function main() {
  if (!process.stdout.isTTY) {
    console.error('build-dashboard: requires an interactive TTY');
    process.exit(1);
  }

  try {
    repoMeta = await captureRepoMeta();
    state.version = repoMeta.label;
    state.branch = repoMeta.branch;
    state.worktree = repoMeta.worktree;
    state.defineVars = buildScript ? parseBuildScriptDefines(buildScript, repoMeta) : [];
    state.message = `Watching source files in ${repoName}`;
    state.lastUpdateAt = formatClock(new Date());

    setupTerminal();
    render();

    spinnerTimer = setInterval(() => {
      if (!state.buildRunning) return;
      state.spinnerIndex = (state.spinnerIndex + 1) % spinnerFrames.length;
      render();
    }, 150);

    gitMetaTimer = setInterval(async () => {
      if (state.buildRunning || state.stopRequested) return;
      try {
        repoMeta = await captureRepoMeta();
        state.version = repoMeta.label;
        state.branch = repoMeta.branch;
        state.worktree = repoMeta.worktree;
        state.defineVars = buildScript ? parseBuildScriptDefines(buildScript, repoMeta) : [];
        render();
      } catch {
        // git unavailable, keep stale values
      }
    }, 30_000);

    elapsedTimer = setInterval(() => {
      if (state.stopRequested) return;
      if (state.history.length === 0) return;
      render();
    }, 1_000);

    await startEventLoop();
    render();
  } catch (error) {
    await shutdownWatchman();
    stopFallbackLoop();
    teardownTerminal();
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  }
}

function setupTerminal() {
  inputStream = createInputStream();
  if (!inputStream || !inputStream.isTTY) {
    throw new Error('build-dashboard: could not attach to the controlling TTY for keyboard input');
  }

  process.stdout.write('\x1b[?1049h\x1b[?25l');
  inputStream.setEncoding('utf8');
  inputStream.setRawMode(true);
  inputStream.resume();
  inputStream.on('data', handleInput);
  process.stdout.on('resize', render);
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);
  process.on('uncaughtException', handleFatal);
  process.on('unhandledRejection', handleFatal);
}

function teardownTerminal() {
  if (spinnerTimer) clearInterval(spinnerTimer);
  if (gitMetaTimer) clearInterval(gitMetaTimer);
  if (elapsedTimer) clearInterval(elapsedTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  if (inputStream) {
    inputStream.off('data', handleInput);
    if (typeof inputStream.setRawMode === 'function') {
      inputStream.setRawMode(false);
    }
    inputStream.pause();
    if (inputStream !== process.stdin) {
      inputStream.destroy();
    }
    inputStream = null;
  }
  if (inputFd !== null) {
    try {
      fsSync.closeSync(inputFd);
    } catch {
      // The TTY stream may already own and close this fd during destroy().
    }
    inputFd = null;
  }
  process.stdout.off('resize', render);
  process.stdout.write('\x1b[?25h\x1b[?1049l');
}

async function requestStop() {
  if (state.stopRequested) return;
  state.stopRequested = true;
  await shutdownWatchman();
  stopFallbackLoop();
  teardownTerminal();
  process.exit(0);
}

async function restartSelf() {
  if (state.stopRequested) return;
  state.stopRequested = true;
  await shutdownWatchman();
  stopFallbackLoop();
  teardownTerminal();
  const child = spawn(process.execPath, process.argv.slice(1), {
    stdio: 'inherit',
    env: process.env,
  });
  child.on('close', (code) => process.exit(code ?? 0));
}

function handleFatal(error) {
  void (async () => {
    await shutdownWatchman();
    stopFallbackLoop();
    teardownTerminal();
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exit(1);
  })();
}

async function startEventLoop() {
  try {
    await startWatchmanLoop();
    state.backend = 'watchman';
  } catch (error) {
    await shutdownWatchman();
    await startFallbackLoop();
    state.backend = 'git polling fallback';
    const reason = error instanceof Error ? error.message : String(error);
    state.message = `Watchman unavailable (${reason}); using git polling fallback`;
    state.lastUpdateAt = formatClock(new Date());
  }
}

function handleInput(chunk) {
  if (chunk === '\u0003') {
    void requestStop();
    return;
  }

  if (chunk === 'q' || chunk === 'Q') {
    void requestStop();
    return;
  }

  if (chunk === 'c' || chunk === 'C') {
    state.history = [];
    state.lastErrorLog = '';
    render();
    return;
  }

  if (chunk === 'e' || chunk === 'E') {
    state.showErrorPane = !state.showErrorPane;
    render();
    return;
  }

  if (chunk === 'b' || chunk === 'B') {
    if (!state.buildRunning && !state.stopRequested) {
      pendingFiles.add('(manual)');
      scheduleBuild();
    }
    return;
  }

  if (chunk === 'r' || chunk === 'R') {
    void restartSelf();
  }
}

function createInputStream() {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    return process.stdin;
  }

  try {
    inputFd = fsSync.openSync('/dev/tty', 'r');
    return new tty.ReadStream(inputFd);
  } catch {
    return process.stdin;
  }
}

async function startWatchmanLoop() {
  const sockname = await new Promise((resolve, reject) => {
    const child = spawn('watchman', ['get-sockname'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('watchman get-sockname failed'));
        return;
      }
      try {
        resolve(JSON.parse(out).sockname);
      } catch {
        reject(new Error('watchman get-sockname: bad JSON'));
      }
    });
    child.on('error', reject);
  });

  await new Promise((resolve, reject) => {
    watchmanSocket = net.createConnection(sockname);
    watchmanSocket.setEncoding('utf8');
    watchmanSocket.on('data', onWatchmanStdout);
    watchmanSocket.on('error', (err) => {
      const pending = watchmanPendingResponses.splice(0);
      for (const p of pending) p.reject(err);
    });
    watchmanSocket.once('connect', resolve);
    watchmanSocket.once('error', reject);
  });

  const watchResponse = await sendWatchmanCommand(['watch-project', repoRoot]);
  watchmanWatchRoot = watchResponse.watch;
  watchmanRelativePath = watchResponse.relative_path ?? '';

  const clockResponse = await sendWatchmanCommand(['clock', watchmanWatchRoot]);
  await sendWatchmanCommand([
    'subscribe',
    watchmanWatchRoot,
    watchmanName,
    {
      since: clockResponse.clock,
      expression: [
        'allof',
        ['type', 'f'],
        ['not', ['dirname', '.git']],
        ['not', ['dirname', 'node_modules']],
        ['not', ['dirname', 'dist']],
        ['not', ['dirname', 'build']],
        ['not', ['dirname', 'web-ext-artifacts']],
        ['not', ['dirname', 'tests']],
        ['not', ['dirname', 'test-results']],
        ['not', ['dirname', 'screenshots']],
        ['not', ['dirname', 'project-files/docs']],
        ['not', ['dirname', '.astro']],
        ['not', ['dirname', '.vercel']],
        ['not', ['dirname', '.bg-shell']],
        ['not', ['dirname', '.planning']],
        ['not', ['dirname', '.gsd']],
        ['not', ['dirname', '.wolf']],
        ['not', ['dirname', '.claude']],
        ['not', ['dirname', '.playwright-profile-firefox']],
        ...ignorePaths.map((p) => {
          const clean = p.replace(/\/$/, '');
          if (clean.includes('/')) {
            return [
              'not',
              ['anyof', ['match', clean, 'wholename'], ['match', `${clean}/**`, 'wholename']],
            ];
          }
          return ['not', ['dirname', clean]];
        }),
      ],
      fields: ['name', 'exists'],
      empty_on_fresh_instance: true,
    },
  ]);
}

function onWatchmanStdout(chunk) {
  watchmanStdoutBuffer += chunk;
  const lines = watchmanStdoutBuffer.split('\n');
  watchmanStdoutBuffer = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.trim()) continue;

    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      state.status = 'error';
      state.message = `watchman parse error: ${line}`;
      render();
      continue;
    }

    if (payload.subscription === watchmanName) {
      handleSubscription(payload);
      continue;
    }

    const pending = watchmanPendingResponses.shift();
    if (!pending) continue;

    if (payload.error) {
      pending.reject(new Error(payload.error));
    } else {
      pending.resolve(payload);
    }
  }
}

function handleSubscription(payload) {
  if (state.stopRequested) return;

  const files = (payload.files ?? [])
    .map((entry) => normalizeWatchmanPath(entry.name))
    .filter(Boolean)
    .filter(shouldWatchFile);

  if (files.length === 0) return;

  for (const file of files) {
    pendingFiles.add(file);
  }

  scheduleBuild();
}

function scheduleBuild() {
  if (state.buildRunning || state.stopRequested) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushPendingBuild();
  }, debounceMs);
}

async function flushPendingBuild() {
  if (state.buildRunning || state.stopRequested || pendingFiles.size === 0) return;

  const triggerFiles = [...pendingFiles].sort();
  pendingFiles = new Set();

  const triggerMeta = await captureRepoMeta();
  const summary = describeTrigger(triggerFiles, repoMeta, triggerMeta);
  const buildStartSha = shaFingerprint(triggerMeta);

  state.buildRunning = true;
  state.status = 'building';
  state.message = `${formatClock(new Date())} ${summary}`;
  state.lastUpdateAt = formatClock(new Date());
  render();

  const startedAt = Date.now();
  let code = 1;
  let output = '';
  let durationMs = 0;

  try {
    const result = await runCommand(buildCommand, repoRoot, buildEnvOverrides);
    code = result.code;
    output = result.output;
    durationMs = Date.now() - startedAt;
  } catch (error) {
    durationMs = Date.now() - startedAt;
    output = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }

  if (state.stopRequested) return;

  repoMeta = await captureRepoMeta();
  state.version = repoMeta.label;
  state.branch = repoMeta.branch;
  state.worktree = repoMeta.worktree;
  state.defineVars = buildScript ? parseBuildScriptDefines(buildScript, repoMeta) : [];
  state.lastUpdateAt = formatClock(new Date());
  state.buildRunning = false;

  state.history.push({
    time: state.lastUpdateAt,
    status: code === 0 ? 'ok' : 'error',
    durationMs,
    finishedAtMs: Date.now(),
    summary,
  });
  trimHistory();

  if (code === 0) {
    state.status = 'ok';
    state.builtSha = buildStartSha;
    state.message = `${state.lastUpdateAt} ${summary}`;
  } else {
    state.status = 'error';
    state.showErrorPane = true;
    state.message = `${state.lastUpdateAt} exit ${code} ${summary}`;
    state.lastErrorLog = tailLines(output, 16);
    if (!state.lastErrorLog) {
      state.lastErrorLog = [
        `Build command failed with exit ${code}.`,
        `Command: ${buildCommand.join(' ')}`,
        'The process returned no stdout/stderr output.',
      ].join('\n');
    }
  }

  render();

  if (pendingFiles.size > 0) {
    scheduleBuild();
  }
}

function normalizeWatchmanPath(name) {
  const normalized = name.replaceAll('\\', '/');
  if (!watchmanRelativePath) return normalized;

  const prefix = `${watchmanRelativePath}/`;
  if (normalized === watchmanRelativePath) return '';
  if (!normalized.startsWith(prefix)) return '';
  return normalized.slice(prefix.length);
}

function shouldWatchFile(relPath) {
  const normalized = relPath.replaceAll('\\', '/');
  if (!normalized) return false;

  const parts = normalized.split('/');
  const basename = parts.at(-1) ?? normalized;

  if (basename.endsWith('.md')) return false;
  if (basename.includes('.test.')) return false;
  if (parts.includes('docs')) return false;
  if (parts.includes('tests')) return false;

  if (normalized.startsWith('project-files/docs/')) return false;
  if (normalized.startsWith('scripts/')) return true;
  if (normalized.startsWith('src/')) return true;
  if (normalized.startsWith('public/')) return true;
  if (normalized.startsWith('project-files/src/')) return true;
  if (normalized.startsWith('project-files/icons/')) return true;
  if (normalized === 'project-files/domains.json') return true;
  if (normalized.startsWith('apps/site/src/')) return true;
  if (normalized.startsWith('apps/site/public/')) return true;
  if (normalized.startsWith('apps/site/') && basename === 'package.json') return true;

  for (const prefix of extraWatchPrefixes) {
    if (normalized.startsWith(prefix)) return true;
  }

  for (const ignore of ignorePaths) {
    const prefix = ignore.endsWith('/') ? ignore : `${ignore}/`;
    if (normalized === ignore || normalized.startsWith(prefix)) return false;
  }

  return rootConfigFiles.has(normalized);
}

function describeTrigger(files, previousMeta, currentMeta) {
  const parts = [];

  if (previousMeta.head !== currentMeta.head) {
    parts.push(`HEAD ${previousMeta.label} -> ${currentMeta.label}`);
  }

  const sample = files.slice(0, 3).join(', ');
  const suffix = files.length > 3 ? ' ...' : '';
  parts.push(`${files.length} file(s): ${sample}${suffix}`);

  return parts.join(' ; ');
}

function parseStatusPaths(snapshot) {
  return snapshot
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim());
}

function diffStatusSnapshots(previousSnapshot, currentSnapshot) {
  const previous = new Set(parseStatusPaths(previousSnapshot));
  const current = new Set(parseStatusPaths(currentSnapshot));
  const changed = [];

  for (const file of current) {
    if (!previous.has(file)) changed.push(file);
  }

  for (const file of previous) {
    if (!current.has(file)) changed.push(file);
  }

  return changed.length > 0 ? changed : parseStatusPaths(currentSnapshot);
}

function shaFingerprint(meta) {
  const dirty = meta.label.endsWith('-dirty');
  return `${meta.head.slice(0, 7)}${dirty ? '-dirty' : ''}`;
}

async function captureRepoMeta() {
  const [head, label, branch, gitDir] = await Promise.all([
    runGit(['rev-parse', 'HEAD']),
    runGit(['describe', '--tags', '--always', '--dirty']),
    runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(['rev-parse', '--git-dir']),
  ]);
  const worktree = gitDir.includes('.git/worktrees/') ? path.basename(gitDir) : '';
  return { head, label, branch, worktree };
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trimEnd());
      } else {
        reject(new Error(stderr.trim() || `git ${args.join(' ')} failed with exit ${code}`));
      }
    });
  });
}

function runCommand(command, cwd, envOverrides = {}) {
  return new Promise((resolve, reject) => {
    const dotEnv = loadDotEnv(path.join(cwd, '.env.local'));
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...dotEnv, ...process.env, ...envOverrides },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const maxOutput = 512 * 1024;

    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.length > maxOutput) output = output.slice(-maxOutput);
    });

    child.stderr.on('data', (chunk) => {
      output += chunk;
      if (output.length > maxOutput) output = output.slice(-maxOutput);
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

function sendWatchmanCommand(command) {
  return new Promise((resolve, reject) => {
    if (!watchmanSocket || watchmanSocket.destroyed) {
      reject(new Error('watchman socket not available'));
      return;
    }
    watchmanPendingResponses.push({ resolve, reject });
    watchmanSocket.write(`${JSON.stringify(command)}\n`);
  });
}

async function shutdownWatchman() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watchmanSocket) {
    watchmanSocket.destroy();
    watchmanSocket = null;
  }
}

async function startFallbackLoop() {
  lastFallbackStatusSnapshot = await runGit([
    'status',
    '--short',
    '--untracked-files=all',
    '--ignored=no',
  ]);
  pollTimer = setInterval(() => {
    void pollFallbackLoop();
  }, fallbackPollMs);
}

function stopFallbackLoop() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function pollFallbackLoop() {
  if (state.stopRequested || state.buildRunning) return;

  const currentSnapshot = await runGit([
    'status',
    '--short',
    '--untracked-files=all',
    '--ignored=no',
  ]);
  if (currentSnapshot === lastFallbackStatusSnapshot) return;

  const changed = diffStatusSnapshots(lastFallbackStatusSnapshot, currentSnapshot).filter(
    shouldWatchFile,
  );

  lastFallbackStatusSnapshot = currentSnapshot;
  if (changed.length === 0) return;

  for (const file of changed) {
    pendingFiles.add(file);
  }

  scheduleBuild();
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function render() {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  const errorPaneLines = state.showErrorPane && state.lastErrorLog ? 8 : 0;

  const statusLabel =
    state.status === 'building'
      ? `${spinnerFrames[state.spinnerIndex]} BUILDING`
      : state.status.toUpperCase();
  const statusColor = statusColors[state.status];

  const lines = [];
  lines.push(`${bold(repoName)}  build dashboard  ${dim(state.backend)}`);
  lines.push(
    `${dim('branch')} ${state.branch}${state.worktree ? `  ${dim('worktree')} ${state.worktree}` : ''}`,
  );
  const ignoreNote = ignorePaths.length ? `  ${dim(`ignoring: ${ignorePaths.join(', ')}`)}` : '';
  lines.push(`${dim('root')}   ${truncate(abbreviatePath(repoRoot), width - 8)}${ignoreNote}`);
  for (const [key, val] of state.defineVars) {
    lines.push(`${dim(key)}  ${val}`);
  }
  const envPrefix = Object.entries(buildEnvOverrides)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  lines.push(
    `${dim('command')} ${envPrefix ? `${envPrefix} ` : ''}${buildCommand.join(' ')}`,
  );
  lines.push(formatVersionLine());
  lines.push(`${statusColor}[${statusLabel}]\x1b[0m ${truncate(state.message, width - 12)}`);
  lines.push('');
  lines.push(tableHeader(width));

  const headerSize = lines.length;
  const historyRows = Math.max(
    5,
    height - headerSize - 2 - (errorPaneLines > 0 ? errorPaneLines + 2 : 0),
  );
  const history = state.history.slice(-historyRows);

  const latestEntry = history.at(-1) ?? null;
  for (const entry of history) {
    lines.push(formatEntry(entry, width, { isLatest: entry === latestEntry }));
  }

  while (lines.length < headerSize + historyRows) {
    lines.push('');
  }

  if (errorPaneLines) {
    lines.push('');
    lines.push(`${bold('Last Error')}${dim('  (toggle with e)')}`);
    for (const line of state.lastErrorLog.split('\n').slice(-errorPaneLines)) {
      lines.push(truncate(line, width));
    }
  }

  lines.push('');
  lines.push(
    dim(
      'watching source files only; tests/docs ignored | q quit  b build  r restart  c clear  e errors',
    ),
  );

  process.stdout.write('\x1b[H\x1b[2J');
  process.stdout.write(lines.slice(0, height).join('\n'));
}

function tableHeader(width) {
  const header = [
    padRight('TIME', 8),
    padRight('STATUS', 10),
    padRight('DURATION', 10),
    'CHANGE',
  ].join('  ');
  return bold(truncate(header, width));
}

function formatEntry(entry, width, options = {}) {
  const { isLatest = false } = options;
  const status =
    entry.status === 'ok' ? `${statusColors.ok}OK\x1b[0m` : `${statusColors.error}ERROR\x1b[0m`;
  const duration = `${(entry.durationMs / 1000).toFixed(1)}s`;
  const ageLabel = isLatest ? formatLatestBuildAge(entry.finishedAtMs) : '';
  const summaryBase = ageLabel ? `${entry.summary}  ${ageLabel}` : entry.summary;
  const summary = truncate(summaryBase, Math.max(20, width - 34));

  return [
    padRight(entry.time, 8),
    padRight(status, 10),
    padRight(duration, 10),
    summary,
  ].join('  ');
}

function trimHistory() {
  const maxEntries = 200;
  if (state.history.length > maxEntries) {
    state.history.splice(0, state.history.length - maxEntries);
  }
}

function loadDotEnv(envFilePath) {
  try {
    const env = {};
    for (const line of fsSync.readFileSync(envFilePath, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if (v.length > 1 && v[0] === v.at(-1) && (v[0] === '"' || v[0] === "'")) v = v.slice(1, -1);
      env[k] = v;
    }
    return env;
  } catch {
    return {};
  }
}

function parseBuildScriptDefines(scriptPath, meta) {
  try {
    const source = fsSync.readFileSync(scriptPath, 'utf8');
    const m = source.match(/\bdefine\s*:\s*\{([^}]*)\}/s);
    if (!m) return [];

    const dotEnv = loadDotEnv(path.join(repoRoot, '.env.local'));
    const env = { ...dotEnv, ...process.env };
    const result = [];

    for (const line of m[1].split('\n')) {
      const t = line.trim().replace(/,$/, '');
      if (!t || t.startsWith('//')) continue;
      const ci = t.indexOf(':');
      if (ci < 0) continue;
      const key = t.slice(0, ci).trim();
      const expr = t.slice(ci + 1).trim();

      let value;
      const m1 = expr.match(
        /JSON\.stringify\(\s*process\.env\.(\w+)\s*\?\?\s*['"]([^'"]*)['"]\s*\)/,
      );
      if (m1) value = env[m1[1]] !== undefined ? env[m1[1]] : m1[2];

      if (value === undefined) {
        const m2 = expr.match(/JSON\.stringify\(\s*process\.env\.(\w+)\s*\)/);
        if (m2) value = env[m2[1]] ?? '';
      }

      if (value === undefined) {
        const m3 = expr.match(/JSON\.stringify\(\s*['"]([^'"]*)['"]\s*\)/);
        if (m3) value = m3[1];
      }

      if (value === undefined && meta && expr.match(/JSON\.stringify\(\s*\w+\(\)\s*\)/)) {
        if (/sha|commit|rev(?:ision)?|hash/i.test(key)) {
          value = shaFingerprint(meta);
        }
      }

      const isSensitive = /token|secret|password|api/i.test(key);
      let display;
      if (value === undefined) {
        display = dim('<computed>');
      } else if (value === '') {
        display = dim('<empty>');
      } else if (isSensitive && value.length > 4) {
        display = `${value.slice(0, 4)}${'*'.repeat(Math.min(value.length - 4, 8))}`;
      } else {
        display = value;
      }

      if (/(?<![a-z])token(?![a-z])/i.test(key)) continue;
      result.push([key, display]);
    }

    return result;
  } catch {
    return [];
  }
}

function abbreviatePath(p) {
  const home = process.env.HOME ?? '';
  return home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function tailLines(text, count) {
  return text.split('\n').slice(-count).join('\n').trimEnd();
}

function formatClock(date) {
  return date.toTimeString().slice(0, 8);
}

function truncate(text, width) {
  if (width <= 0) return '';
  if (text.length <= width) return text;
  if (width <= 1) return text.slice(0, width);
  return `${text.slice(0, width - 1)}…`;
}

function padRight(text, width) {
  const visibleWidth = stripAnsi(text).length;
  const padding = Math.max(0, width - visibleWidth);
  return `${text}${' '.repeat(padding)}`;
}

function bold(text) {
  return `\x1b[1m${text}\x1b[0m`;
}

function dim(text) {
  return `\x1b[2m${text}\x1b[0m`;
}

function formatVersionLine() {
  const versionParts = [formatVersionValue()];

  if (state.builtSha && repoMeta) {
    const currentSha = shaFingerprint(repoMeta);
    const synced = state.builtSha === currentSha;
    const indicator = synced
      ? '\x1b[32m✓ synced\x1b[0m'
      : `\x1b[33m↑ stale  (built from ${currentSha})\x1b[0m`;
    versionParts.push(indicator);
  }

  return `${dim('version')} ${versionParts.join('  ')}`;
}

function formatVersionValue() {
  const version = state.version || 'unknown';
  if (!state.builtSha) return version;

  const escapedSha = escapeRegExp(state.builtSha);
  return version.replace(new RegExp(`${escapedSha}(?=\\b)`), colorizeBuildSha(state.builtSha));
}

function colorizeBuildSha(sha) {
  return `\x1b[38;5;81m${sha}\x1b[0m`;
}

function orange(text) {
  return `\x1b[38;5;214m${text}\x1b[0m`;
}

function orangeBackground(text) {
  return `\x1b[30;48;5;214m${text}\x1b[0m`;
}

function stripAnsi(text) {
  return text.replace(_stripAnsiRe, '');
}

function ansiVisibleDelta(text) {
  return text.length - stripAnsi(text).length;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatLatestBuildAge(finishedAtMs) {
  if (!Number.isFinite(finishedAtMs)) return '';
  const ageSeconds = Math.max(0, Math.floor((Date.now() - finishedAtMs) / 1000));
  const label = `${formatElapsed(ageSeconds)} since build`;
  return Date.now() - finishedAtMs < latestBuildFlashMs ? orangeBackground(label) : orange(label);
}

function formatElapsed(totalSeconds) {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}
