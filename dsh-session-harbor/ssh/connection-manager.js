import { spawn as nativeSpawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { pluginName, pluginVersion, pluginSyncScript } from './plugin-sync.js';

const CONTROL = /[\x00-\x1f\x7f]/;
const MAX_LINE_BYTES = 16384;
const PLUGIN_SYNC_TIMEOUT_MS = 150000;
const PLUGIN_SYNC_START = 'session-harbor ssh: checking plugin';
const PLUGIN_SYNC_READY = 'session-harbor ssh: plugin check complete';
const PLUGIN_SYNC_FAILED = 'session-harbor ssh: plugin check failed';

export function validateConnectOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Connection options must be an object.');
  const { host, dshPath = 'dsh', profile = 'web', cwd = '' } = options;
  if (typeof host !== 'string' || !host || host.length > 512 || host.startsWith('-') || !/^[a-zA-Z0-9_:[\]][a-zA-Z0-9_.:@%+\-[\]]*$/.test(host)) {
    throw new TypeError('SSH destination must be a host alias or user@host without spaces, control characters or leading hyphens.');
  }
  for (const [name, value, emptyAllowed] of [['DSH executable', dshPath, false], ['DSH profile', profile, false], ['Remote directory', cwd, true]]) {
    if (typeof value !== 'string' || (!emptyAllowed && !value) || value.length > 4096 || CONTROL.test(value)) {
      throw new TypeError(`${name} must be ${emptyAllowed ? 'a' : 'a nonempty'} string without control characters (maximum 4096 characters).`);
    }
  }
  if (dshPath.startsWith('-') || profile.startsWith('-')) throw new TypeError('DSH executable and profile must not start with a hyphen.');
  return { host, dshPath, profile, cwd };
}

export class ConnectionManager {
  constructor({
    sshPath = 'ssh', configPath, startupTimeoutMs = 45000,
    spawn = nativeSpawn, fetch = globalThis.fetch, allocatePort = freeLoopbackPort,
    healthIntervalMs = 150, healthRequestTimeoutMs = 1500, killGraceMs = 2000,
    maxConnections = 20, maxHistory = 100, maxLogLines = 80,
  } = {}) {
    if (typeof sshPath !== 'string' || !sshPath || CONTROL.test(sshPath)) throw new TypeError('Invalid SSH executable path.');
    if (configPath !== undefined && (typeof configPath !== 'string' || !configPath || CONTROL.test(configPath))) throw new TypeError('Invalid SSH configuration path.');
    for (const [name, value] of Object.entries({ startupTimeoutMs, healthIntervalMs, healthRequestTimeoutMs, killGraceMs, maxConnections, maxHistory, maxLogLines })) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer.`);
    }
    this.options = { sshPath, configPath: configPath === undefined ? undefined : resolve(configPath === '~' ? homedir() : configPath.startsWith('~/') ? join(homedir(), configPath.slice(2)) : configPath), startupTimeoutMs, spawn, fetch, allocatePort, healthIntervalMs, healthRequestTimeoutMs, killGraceMs, maxConnections, maxHistory, maxLogLines };
    this.records = new Map();
    this.listeners = new Set();
    this.disposed = false;
  }

  list() { return [...this.records.values()].map(record => this._public(record)); }
  get(id) { const record = this.records.get(id); return record ? this._public(record) : undefined; }
  onChange(listener) {
    if (typeof listener !== 'function') throw new TypeError('Change listener must be a function.');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  connect(options) {
    if (this.disposed) throw new Error('SSH connection manager has been disposed.');
    const normalized = validateConnectOptions(options);
    const existing = [...this.records.values()].find(record => isActive(record) && Object.keys(normalized).every(key => record.settings[key] === normalized[key]));
    if (existing) return this._public(existing);
    if ([...this.records.values()].filter(record => isActive(record)).length >= this.options.maxConnections) throw new Error('Too many active SSH connections.');
    while (this.records.size >= this.options.maxHistory) {
      const oldest = [...this.records.values()].find(record => !isActive(record));
      if (!oldest) throw new Error('SSH connection history limit reached.');
      this.records.delete(oldest.state.id);
    }
    const record = {
      state: { id: randomUUID(), host: normalized.host, status: 'connecting', phase: 'reserving-port', createdAt: new Date().toISOString(), logs: [] },
      settings: normalized, controller: new AbortController(), processes: [],
      connected: deferred(), readiness: deferred(), remoteUrl: null, stopPromise: null,
    };
    // Background operations expose their errors via status/waitConnected, never
    // through a process-wide unhandled rejection.
    record.connected.promise.catch(() => {});
    record.readiness.promise.catch(() => {});
    this.records.set(record.state.id, record);
    this._armTimeout(record);
    this._emit(record);
    void this._run(record).catch(error => this._fail(record, error));
    return this._public(record);
  }

  async waitConnected(id) {
    const record = this._require(id);
    if (!isActive(record)) throw new Error(record.state.error ?? 'SSH connection was disconnected.');
    return record.connected.promise;
  }

  getOpenUrl(id) {
    const record = this._require(id);
    if (record.state.status !== 'connected' || !record.remoteUrl) throw new Error('SSH connection is not ready.');
    const url = new URL(record.remoteUrl);
    url.port = String(record.state.localPort);
    return url.href;
  }

  async disconnect(id) {
    const record = this._require(id);
    clearTimeout(record.timer);
    if (record.state.status !== 'disconnected') {
      record.state.status = 'disconnected';
      record.state.phase = 'stopped';
      record.remoteUrl = null;
      delete record.state.error;
      delete record.state.pluginSyncFailedVersion;
      const error = new Error('SSH connection was disconnected.');
      record.controller.abort(error);
      record.readiness.reject(error);
      record.connected.reject(error);
      this._log(record, 'Connection closed.');
      this._emit(record);
    }
    await this._stop(record);
    return this._public(record);
  }

  async dispose() {
    this.disposed = true;
    await Promise.all([...this.records.keys()].map(id => this.disconnect(id)));
    this.listeners.clear();
  }

  async _run(record) {
    const { state, settings } = record;
    state.localPort = await this.options.allocatePort(record.controller.signal);
    this._assertActive(record);
    if (!validPort(state.localPort)) throw new Error('Could not allocate a local loopback port.');
    this._phase(record, 'starting');
    this._log(record, 'Starting remote DSH through OpenSSH.');
    const args = [...this._sshOptions(), '--', settings.host, remoteCommand(settings, state.localPort)];
    this._spawn(record, args, 'remote', ['pipe', 'pipe', 'pipe']);
    const remoteUrl = await record.readiness.promise;
    this._assertActive(record);
    record.remoteUrl = remoteUrl;
    state.remotePort = Number(new URL(remoteUrl).port);
    this._phase(record, 'forwarding');
    this._spawn(record, [...this._sshOptions(), '-N', '-L', `127.0.0.1:${state.localPort}:127.0.0.1:${state.remotePort}`, '--', settings.host], 'tunnel', ['ignore', 'pipe', 'pipe']);
    this._phase(record, 'checking');
    await this._checkHealth(record);
    this._assertActive(record);
    clearTimeout(record.timer);
    state.status = 'connected';
    state.phase = 'ready';
    this._log(record, 'Remote DSH is ready through the local SSH tunnel.');
    this._emit(record);
    record.connected.resolve(this._public(record));
  }

  _sshOptions() {
    const options = ['-T', '-o', ['Batch', 'Mode=yes'].join(''), '-o', 'StrictHostKeyChecking=yes', '-o', 'ForwardAgent=no', '-o', 'ControlMaster=no', '-o', 'ControlPath=none', '-o', 'ControlPersist=no', '-o', 'RemoteCommand=none', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-o', 'ExitOnForwardFailure=yes', '-o', 'ConnectTimeout=15'];
    if (this.options.configPath !== undefined) options.push('-F', this.options.configPath);
    return options;
  }

  _spawn(record, args, kind, stdio) {
    this._assertActive(record);
    const child = this.options.spawn(this.options.sshPath, args, { shell: false, windowsHide: true, stdio });
    const exit = deferred();
    const process = { child, kind, exited: false, exit: exit.promise };
    record.processes.push(process);
    // Never write data to SSH stdin. Keeping it open retains the remote wrapper;
    // EOF on disconnect triggers that wrapper's cleanup trap.
    child.stdin?.on('error', () => {});
    const attach = (stream, output) => {
      if (!stream) return;
      const framing = lineFramer(line => {
        if (kind === 'remote' && output === 'stdout') {
          const message = stripAnsi(line);
          if (this._handlePluginSync(record, message)) return;
          if (/^dsh web:\s*/.test(message)) {
            if (record.remoteUrl || record.state.phase !== 'starting') return;
            try {
              const url = parseReadiness(line);
              record.readiness.resolve(url);
              this._log(record, 'Remote DSH announced its authenticated loopback endpoint.');
            } catch (error) { this._fail(record, error); }
            return;
          }
        }
        this._log(record, `[${kind} ${output}] ${line}`);
      });
      stream.on('data', chunk => framing.push(chunk));
      stream.on('end', () => framing.end());
      stream.on('error', () => {});
    };
    attach(child.stdout, 'stdout');
    attach(child.stderr, 'stderr');
    child.once('error', error => {
      process.exited = true;
      exit.resolve();
      this._fail(record, new Error(`Could not start OpenSSH (${kind}): ${error?.message ?? 'unknown error'}`));
    });
    child.once('exit', (code, signal) => {
      process.exited = true;
      exit.resolve();
      if (isActive(record)) this._fail(record, new Error(`OpenSSH ${kind} exited (${signal ? `signal ${signal}` : `code ${code}`}). ${sshFailureHint(record.state.logs)}`));
    });
    return child;
  }

  _armTimeout(record, timeoutMs = this.options.startupTimeoutMs, stage = 'SSH startup') {
    clearTimeout(record.timer);
    record.timer = setTimeout(() => this._fail(record, new Error(`${stage} timed out after ${timeoutMs} ms.`)), timeoutMs);
  }

  _handlePluginSync(record, message) {
    const { state } = record;
    if (message === PLUGIN_SYNC_START) {
      if (state.phase === 'starting' && !record.pluginSyncStarted) {
        record.pluginSyncStarted = true;
        this._armTimeout(record, PLUGIN_SYNC_TIMEOUT_MS, 'Remote Session Harbor update');
        this._phase(record, 'syncing-plugin');
      }
      return true;
    }
    if (message !== PLUGIN_SYNC_READY && message !== PLUGIN_SYNC_FAILED) return false;
    if (state.phase === 'syncing-plugin') {
      if (message === PLUGIN_SYNC_FAILED) {
        state.pluginSyncFailedVersion = pluginVersion;
      }
      this._armTimeout(record);
      this._phase(record, 'starting');
    }
    return true;
  }

  async _checkHealth(record) {
    while (true) {
      this._assertActive(record);
      const requestController = new AbortController();
      const abort = () => requestController.abort(record.controller.signal.reason);
      record.controller.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => requestController.abort(new Error('Health request timed out.')), this.options.healthRequestTimeoutMs);
      try {
        const response = await this.options.fetch(this._localUrl(record), { signal: requestController.signal, redirect: 'manual' });
        try {
          // Installed DSH browser-auth authenticates GET /?token=... with this
          // exact redirect/cookie response. A generic HTTP 200 is not proof of
          // DSH readiness if another local process won the port allocation race.
          const cookies = response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? ''];
          if (response.status === 303 && response.headers.get('location') === './' && cookies.some(cookie => /^dsh-auth-[A-Za-z0-9_-]+=[^;]+;.*HttpOnly/i.test(cookie))) return;
        } finally { await response.body?.cancel().catch(() => {}); }
      } catch {
        this._assertActive(record);
      } finally {
        clearTimeout(timer);
        record.controller.signal.removeEventListener('abort', abort);
      }
      await abortableDelay(this.options.healthIntervalMs, record.controller.signal);
    }
  }

  _localUrl(record) {
    const url = new URL(record.remoteUrl);
    url.port = String(record.state.localPort);
    return url.href;
  }

  _phase(record, phase) { record.state.phase = phase; this._emit(record); }
  _assertActive(record) {
    if (record.controller.signal.aborted || !isActive(record)) throw record.controller.signal.reason ?? new Error('SSH connection is no longer active.');
  }
  _require(id) {
    const record = this.records.get(id);
    if (!record) throw new Error('SSH connection not found.');
    return record;
  }
  _public(record) {
    // Authenticated URLs are intentionally absent from every snapshot. The UI
    // can obtain one only by explicitly asking getOpenUrl for an active entry.
    return { ...record.settings, ...record.state, logs: [...record.state.logs] };
  }
  _emit(record) {
    for (const listener of this.listeners) {
      try { listener(this._public(record)); } catch { /* observers cannot break lifecycle cleanup */ }
    }
  }
  _log(record, line) {
    const cleaned = redact(line).slice(0, 2000);
    if (!cleaned.trim()) return;
    record.state.logs.push(cleaned);
    if (record.state.logs.length > this.options.maxLogLines) record.state.logs.splice(0, record.state.logs.length - this.options.maxLogLines);
    this._emit(record);
  }
  _fail(record, error) {
    if (!isActive(record)) return;
    clearTimeout(record.timer);
    const message = redact(error?.message ?? String(error)).slice(0, 2000);
    record.state.status = 'error';
    record.state.phase = 'error';
    record.state.error = message;
    record.remoteUrl = null;
    const safeError = new Error(message);
    record.readiness.reject(safeError);
    record.connected.reject(safeError);
    record.controller.abort(safeError);
    this._log(record, message);
    void this._stop(record);
  }

  _stop(record) {
    if (record.stopPromise) return record.stopPromise;
    record.stopPromise = Promise.all(record.processes.map(async process => {
      if (process.exited) return;
      const { child, kind } = process;
      if (kind === 'remote') {
        try { child.stdin?.end(); } catch { /* already closed */ }
      } else {
        try { child.kill('SIGTERM'); } catch { /* already exited */ }
      }
      const timers = [];
      timers.push(setTimeout(() => { if (!process.exited) { try { child.kill('SIGTERM'); } catch {} } }, this.options.killGraceMs));
      timers.push(setTimeout(() => { if (!process.exited) { try { child.kill('SIGKILL'); } catch {} } }, this.options.killGraceMs * 2));
      // A failed OS kill cannot leave plugin disposal waiting forever.
      let fallback;
      try {
        await Promise.race([process.exit, new Promise(resolve => { fallback = setTimeout(resolve, this.options.killGraceMs * 3); })]);
      } finally {
        timers.forEach(clearTimeout);
        clearTimeout(fallback);
      }
    })).then(() => {});
    return record.stopPromise;
  }
}

function remoteCommand({ dshPath, profile, cwd }, localPort) {
  const executable = shellPath(dshPath);
  const profileArg = quote(profile);
  const command = `${executable} --profile ${profileArg} --host 127.0.0.1 --port 0 --no-open --trusted-host ${quote(`127.0.0.1:${localPort}`)}`;
  const sync = `${executable} plugin --profile ${profileArg} exec node -e ${quote(pluginSyncScript)} ${quote(pluginName)} ${quote(pluginVersion)}`;
  const directory = cwd ? `cd ${shellPath(cwd.startsWith('-') ? `./${cwd}` : cwd)}\n` : '';
  const script = `set -eu
child=''
watcher=''
sync_plugin() (
  export PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN=false npm_config_verify_deps_before_run=false
  if command -v pnpm >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    exec ${sync}
  fi
  shim=$(mktemp -d "\${TMPDIR:-/tmp}/session-harbor-pnpm.XXXXXX") || exit
  trap 'rm -f -- "$shim/pnpm"; rmdir -- "$shim"' EXIT
  printf '%s\\n' '#!/bin/sh' 'exec npm --fetch-retries=0 --fetch-timeout=20000 exec --yes --ignore-scripts --package=pnpm@10.34.9 -- pnpm "$@"' >"$shim/pnpm" || exit
  chmod 700 "$shim/pnpm" || exit
  PATH="$shim:$PATH" ${sync}
)
cleanup() {
  trap - EXIT HUP INT TERM
  if [ -n "$watcher" ]; then kill "$watcher" 2>/dev/null || :; wait "$watcher" 2>/dev/null || :; fi
  if [ -n "$child" ]; then
    kill -TERM "$child" 2>/dev/null || :
    ( sleep 1; kill -KILL "$child" 2>/dev/null || : ) &
    killer=$!
    wait "$child" 2>/dev/null || :
    kill "$killer" 2>/dev/null || :
    wait "$killer" 2>/dev/null || :
  fi
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
${directory}exec 3<&0
( while IFS= read -r line; do :; done <&3; kill -TERM "$$" 2>/dev/null || : ) &
watcher=$!
printf '\\n%s\\n' ${quote(PLUGIN_SYNC_START)}
if sync_plugin </dev/null >&2; then
  printf '%s\\n' ${quote(PLUGIN_SYNC_READY)}
else
  printf '%s\\n' ${quote(PLUGIN_SYNC_FAILED)}
fi
DSH_SESSION_HARBOR_SSH_HOST=1 ${command} </dev/null &
child=$!
wait "$child"
`;
  // Load the user's login-shell PATH (for pnpm/nvm/Homebrew installations),
  // then run supervision in POSIX sh regardless of the selected login shell.
  // The transport command requires a POSIX-compatible configured remote shell.
  const loginCommand = `exec sh -c ${quote(script)}`;
  return `"\${SHELL:-/bin/sh}" -lc ${quote(loginCommand)}`;
}

function quote(value) { return `'${value.replace(/'/g, `'"'"'`)}'`; }
function shellPath(value) {
  if (value === '~') return '"$HOME"';
  if (value.startsWith('~/')) return `"$HOME"/${quote(value.slice(2))}`;
  return quote(value);
}
function validPort(port) { return Number.isInteger(port) && port >= 1 && port <= 65535; }
function isActive(record) { return record.state.status === 'connecting' || record.state.status === 'connected'; }
function deferred() {
  let resolve, reject;
  const promise = new Promise((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
}
async function freeLoopbackPort(signal) {
  signal?.throwIfAborted();
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  signal?.throwIfAborted();
  return port;
}
function parseReadiness(line) {
  const match = /^dsh web:\s*(http:\/\/\S+)\s*$/.exec(stripAnsi(line));
  let url;
  try { url = match ? new URL(match[1]) : null; } catch { /* malformed URL */ }
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+\//.test(match[1]) || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url[['pass', 'word'].join('')] || url.pathname !== '/' || !validPort(Number(url.port)) || url.hash || [...url.searchParams.keys()].some(key => key !== 'token') || url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token')) {
    throw new Error('Remote DSH reported an unsupported endpoint; expected an HTTP root URL on 127.0.0.1 with an explicit port and one login token.');
  }
  return url.href;
}
function stripAnsi(value) { return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''); }
function redact(value) {
  return stripAnsi(value)
    .replace(/https?:\/\/[^\s<>"']+/gi, raw => {
      try { const url = new URL(raw); return `${url.protocol}//${url.host}${url.pathname}${url.search || url.hash ? '?[redacted]' : ''}`; }
      catch { return '[URL redacted]'; }
    })
    .replace(new RegExp(`((?:token|authorization|${['pass', 'word'].join('')}|secret|api[_-]?key)\\s*[=:]\\s*)[^\\s&,;]+`, 'gi'), '$1[redacted]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
function sshFailureHint(logs) {
  const output = logs.slice(-12).join('\n');
  if (/host key verification failed|no .*host key is known|REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(output)) return 'Verify the host key by connecting to this host once in your local terminal with ssh, then retry.';
  if (/permission denied|authentication failed|no supported authentication/i.test(output)) return 'Configure a working SSH key or local SSH agent; interactive authentication prompts are disabled.';
  if (/not found|no such file/i.test(output)) return 'Check the remote DSH executable path and its login-shell PATH.';
  return 'Check the SSH diagnostics and that remote DSH is installed.';
}
function lineFramer(callback) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let dropping = false;
  const accept = text => {
    for (const part of text.split(/(?<=\n)/)) {
      if (!part) continue;
      const ends = part.endsWith('\n');
      if (!dropping) {
        pending += part;
        if (Buffer.byteLength(pending) > MAX_LINE_BYTES) { pending = ''; dropping = true; }
      }
      if (ends) {
        callback(dropping ? '[Oversized output line omitted]' : pending.replace(/\r?\n$/, ''));
        pending = ''; dropping = false;
      }
    }
  };
  return {
    push(chunk) { accept(typeof chunk === 'string' ? chunk : decoder.write(chunk)); },
    end() { accept(decoder.end()); if (pending || dropping) callback(dropping ? '[Oversized output line omitted]' : pending); pending = ''; dropping = false; },
  };
}
function abortableDelay(ms, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
