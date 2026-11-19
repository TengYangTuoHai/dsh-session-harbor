import { glob, open, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 4 * MAX_FILE_BYTES;
const MAX_FILES = 128;
const MAX_DEPTH = 16;
const MAX_HOSTS = 512;
const CONTROL = /[\x00-\x20\x7f]/;

// This is a bounded discovery reader. OpenSSH itself evaluates the configuration
// (including Match, canonicalisation and ProxyCommand) when a connection starts.
export async function readSshConfig({ configPath = join(homedir(), '.ssh/config'), sshDirectory = join(homedir(), '.ssh') } = {}) {
  if (typeof configPath !== 'string' || !configPath || /[\x00-\x1f\x7f]/.test(configPath)) {
    throw new TypeError('SSH configuration path must be a nonempty path without control characters.');
  }
  if (typeof sshDirectory !== 'string' || !sshDirectory || /[\x00-\x1f\x7f]/.test(sshDirectory)) throw new TypeError('Invalid SSH directory.');
  const path = resolve(expandHome(configPath));
  // OpenSSH resolves relative user Include paths against ~/.ssh even when -F
  // names a config elsewhere. Tests can substitute this base directory.
  const includeBase = resolve(expandHome(sshDirectory));
  const warnings = [];
  const directives = [];
  const active = new Set();
  let fileCount = 0;
  let totalBytes = 0;
  const warn = message => { if (warnings.length < 100 && !warnings.includes(message)) warnings.push(message); };

  async function visit(filename, depth) {
    if (depth > MAX_DEPTH) return warn(`SSH Include depth exceeds ${MAX_DEPTH}: ${filename}`);
    if (++fileCount > MAX_FILES) return warn(`SSH Include file limit (${MAX_FILES}) reached.`);
    let canonical;
    try {
      canonical = await realpath(filename);
      if (active.has(canonical)) return warn(`SSH Include cycle skipped: ${filename}`);
      const info = await stat(canonical);
      if (!info.isFile()) return warn(`SSH configuration is not a regular file: ${filename}`);
      if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES) {
        return warn(`SSH configuration size limit exceeded: ${filename}`);
      }
      // Read through a fixed-capacity buffer: a concurrent file growth must not
      // bypass the limits or allocate an unbounded readFile buffer.
      const handle = await open(canonical, 'r');
      let buffer;
      try {
        const capacity = Math.min(MAX_FILE_BYTES, MAX_TOTAL_BYTES - totalBytes) + 1;
        const bytes = Buffer.alloc(capacity);
        let length = 0;
        while (length < capacity) {
          const { bytesRead } = await handle.read(bytes, length, capacity - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        buffer = bytes.subarray(0, length);
      } finally { await handle.close(); }
      totalBytes += buffer.length;
      if (buffer.length > MAX_FILE_BYTES || totalBytes > MAX_TOTAL_BYTES) {
        return warn(`SSH configuration size limit exceeded: ${filename}`);
      }
      active.add(canonical);
      try {
        const lines = buffer.toString('utf8').split(/\r?\n/);
        for (let index = 0; index < lines.length; index++) {
          if (directives.length >= 20000) { warn('SSH configuration directive limit reached.'); break; }
          let tokens;
          try { tokens = tokenize(lines[index]); }
          catch { warn(`Malformed SSH configuration line skipped: ${filename}:${index + 1}`); continue; }
          if (!tokens.length) continue;
          const key = tokens.shift().toLowerCase();
          if (tokens[0] === '=') tokens.shift();
          if (key !== 'include') {
            directives.push({ key, values: tokens, source: filename });
            continue;
          }
          for (const value of tokens) {
            if (!value || /[\x00-\x1f\x7f]/.test(value)) { warn(`Invalid SSH Include path skipped: ${filename}`); continue; }
            const expanded = expandHome(value);
            if (expanded.startsWith('~')) { warn(`Named-user SSH Include paths are not expanded: ${filename}`); continue; }
            const pattern = isAbsolute(expanded) ? expanded : resolve(includeBase, expanded);
            let matches;
            try {
              matches = [];
              for await (const match of glob(pattern)) {
                matches.push(match);
                if (matches.length > MAX_FILES) break;
              }
              matches.sort();
            } catch { warn(`SSH Include path could not be expanded: ${filename}`); continue; }
            for (const match of matches) {
              if (fileCount >= MAX_FILES) { warn(`SSH Include file limit (${MAX_FILES}) reached.`); break; }
              await visit(match, depth + 1);
            }
          }
        }
      } finally { active.delete(canonical); }
    } catch (error) {
      warn(`${error?.code === 'ENOENT' ? 'SSH configuration not found' : 'Cannot read SSH configuration'}: ${filename}`);
    }
  }

  await visit(path, 0);
  const aliases = new Map();
  for (const { key, values, source } of directives) {
    if (key !== 'host') continue;
    for (const alias of values) {
      if (!alias || alias.length > 512 || alias.startsWith('!') || /[*?\[\]]/.test(alias) || CONTROL.test(alias) || alias.startsWith('-')) continue;
      if (aliases.has(alias.toLowerCase())) continue;
      if (aliases.size >= MAX_HOSTS) { warn(`SSH host alias limit (${MAX_HOSTS}) reached.`); break; }
      aliases.set(alias.toLowerCase(), { alias, source });
    }
  }

  const fields = { hostname: 'hostname', user: 'user', port: 'port', identityfile: 'identityFile', proxyjump: 'proxyJump' };
  let sawMatch = false;
  for (const host of aliases.values()) {
    let matches = true;
    for (const directive of directives) {
      if (directive.key === 'host') { matches = matchHost(host.alias, directive.values); continue; }
      if (directive.key === 'match') { matches = false; sawMatch = true; continue; }
      const field = fields[directive.key];
      if (!matches || !field || host[field] !== undefined || !directive.values.length) continue;
      const value = directive.values.join(' ');
      if (/[\x00-\x1f\x7f]/.test(value)) continue;
      if (field === 'port') {
        const port = Number(value);
        if (Number.isInteger(port) && port >= 1 && port <= 65535) host.port = port;
      } else host[field] = value;
    }
  }
  if (sawMatch) warn('Match conditions are not evaluated for the host preview; OpenSSH applies them when connecting.');
  return { path, hosts: [...aliases.values()], warnings };
}

function expandHome(value) {
  return value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
}

function matchHost(alias, patterns) {
  let positive = false;
  for (const value of patterns) {
    const negative = value.startsWith('!');
    const pattern = negative ? value.slice(1) : value;
    if (!matchPattern(alias.toLowerCase(), pattern.toLowerCase())) continue;
    if (negative) return false;
    positive = true;
  }
  return positive;
}

function matchPattern(value, pattern) {
  // Greedy wildcard matching avoids regex backtracking on user config patterns.
  // Longer patterns are irrelevant for the bounded host names in this preview.
  if (pattern.length > 1024) return false;
  let position = 0, index = 0, star = -1, checkpoint = 0, steps = 0;
  while (position < value.length) {
    if (++steps > 8192) return false;
    if (pattern[index] === '?' || pattern[index] === value[position]) { index++; position++; }
    else if (pattern[index] === '*') { star = index++; checkpoint = position; }
    else if (star !== -1) { index = star + 1; position = ++checkpoint; }
    else return false;
  }
  while (pattern[index] === '*') index++;
  return index === pattern.length;
}

function tokenize(line) {
  if (line.length > 65536) throw new Error('Line too long');
  const result = [];
  let value = '';
  let quote = '';
  let active = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '\\') {
      if (index + 1 >= line.length) throw new Error('Incomplete escape');
      value += line[++index]; active = true; continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      else value += char;
      active = true; continue;
    }
    if (char === '"' || char === "'") { quote = char; active = true; continue; }
    if (char === '#' && !active) break;
    if (/\s/.test(char) || (char === '=' && result.length === 0)) {
      if (active) { result.push(value); value = ''; active = false; }
      continue;
    }
    value += char; active = true;
  }
  if (quote) throw new Error('Unclosed quote');
  if (active) result.push(value);
  return result;
}
