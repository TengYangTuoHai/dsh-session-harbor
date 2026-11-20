import { readFileSync } from 'node:fs';

export const { name: pluginName, version: pluginVersion } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

function compareVersions(left, right) {
  function parse(version) {
    const match = typeof version === 'string'
      && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-z-]+(?:\.[\da-z-]+)*))?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i.exec(version);
    if (!match) throw new Error('Invalid Session Harbor package version.');
    return { core: match.slice(1, 4).map(BigInt), pre: match[4]?.split('.') };
  }

  const a = parse(left);
  const b = parse(right);
  const compare = (x, y) => x < y ? -1 : x > y ? 1 : 0;
  for (let index = 0; index < a.core.length; index++) {
    const order = compare(a.core[index], b.core[index]);
    if (order) return order;
  }
  if (!a.pre || !b.pre) return compare(Number(!a.pre), Number(!b.pre));
  for (let index = 0; index < Math.min(a.pre.length, b.pre.length); index++) {
    const x = a.pre[index];
    const y = b.pre[index];
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    const order = xNumeric && yNumeric ? compare(BigInt(x), BigInt(y))
      : xNumeric !== yNumeric ? compare(Number(yNumeric), Number(xNumeric)) : compare(x, y);
    if (order) return order;
  }
  return compare(a.pre.length, b.pre.length);
}

// This function runs in the remote profile under `dsh plugin … exec`, whose
// package lock covers the installed-version check, pnpm and bundle reconciliation.
function syncPlugin(compare, name, wantedVersion) {
  const { spawnSync } = require('node:child_process');
  const { readFileSync } = require('node:fs');
  const { join } = require('node:path');
  const installedManifest = join('node_modules', name, 'package.json');

  function installedVersion() {
    let contents;
    try { contents = readFileSync(installedManifest, 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const pkg = JSON.parse(contents);
    if (pkg.name !== name || typeof pkg.version !== 'string') {
      throw new Error('Cannot identify the installed Session Harbor package.');
    }
    return pkg.version;
  }

  const current = installedVersion();
  if (current !== null && compare(current, wantedVersion) >= 0) return;

  const profile = JSON.parse(readFileSync('package.json', 'utf8'));
  if (profile.dsh?.profile?.bundles?.includes('@local/dsh-t3-session-sidebar')) {
    throw new Error('Remove the legacy T3 Session Sidebar bundle before installing Session Harbor.');
  }
  const result = spawnSync(process.env.npm_execpath || 'pnpm', [
    'add', `${name}@${wantedVersion}`, '--save-exact', '--ignore-scripts',
    '--config.fetch-retries=0', '--config.fetch-timeout=20000',
  ], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    return;
  }
  if (installedVersion() !== wantedVersion) throw new Error(`Expected ${name}@${wantedVersion} after installation.`);
}

export const pluginSyncScript = `(${syncPlugin})(${compareVersions}, ...process.argv.slice(1));`;
