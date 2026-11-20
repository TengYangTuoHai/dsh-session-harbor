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
  const { randomUUID } = require('node:crypto');
  const { readFileSync, renameSync, rmSync, statSync, writeFileSync } = require('node:fs');
  const { join } = require('node:path');
  const legacyName = '@local/dsh-t3-session-sidebar';
  const manifestPath = 'package.json';
  const readProfile = () => JSON.parse(readFileSync(manifestPath, 'utf8'));

  function installedVersion(packageName) {
    let contents;
    try { contents = readFileSync(join('node_modules', packageName, manifestPath), 'utf8'); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
    const pkg = JSON.parse(contents);
    if (pkg.name !== packageName || typeof pkg.version !== 'string') {
      throw new Error(`Cannot identify the installed ${packageName} package.`);
    }
    return pkg.version;
  }

  function pnpm(...args) {
    const result = spawnSync(process.env.npm_execpath || 'pnpm', [
      ...args, '--ignore-scripts', '--config.fetch-retries=0', '--config.fetch-timeout=20000',
    ], { stdio: 'inherit' });
    if (result.error) throw result.error;
    return result.status ?? 1;
  }

  const before = readProfile();
  const bundles = before.dsh?.profile?.bundles ?? [];
  const migrate = bundles.includes(legacyName);
  const current = installedVersion(name);
  const install = current === null || compare(current, wantedVersion) < 0;
  const replacement = install ? wantedVersion : current;
  const legacy = migrate ? installedVersion(legacyName) : null;
  if (legacy !== null && compare(legacy, replacement) > 0) return;

  if (install) {
    const status = pnpm('add', `${name}@${wantedVersion}`, '--save-exact');
    if (status !== 0) {
      process.exitCode = status;
      return;
    }
    if (installedVersion(name) !== wantedVersion) throw new Error(`Expected ${name}@${wantedVersion} after installation.`);
  }

  if (migrate) {
    // The old bundle remains selected until its replacement is on disk. Switch
    // the layer before unlinking the old package so interruption leaves one
    // selected bundle, even if the replacement was staged by an earlier attempt.
    const after = readProfile();
    const selected = after.dsh.profile.bundles;
    after.dsh.profile.bundles = selected.includes(name)
      ? selected.filter(bundle => bundle !== legacyName)
      : selected.map(bundle => bundle === legacyName ? name : bundle);
    const temporary = `.${manifestPath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(after, null, 2) + '\n', { flag: 'wx', mode: statSync(manifestPath).mode & 0o777 });
      renameSync(temporary, manifestPath);
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  if ((migrate || bundles.includes(name)) && Object.hasOwn(before.dependencies ?? {}, legacyName)) {
    try {
      if (pnpm('remove', legacyName) !== 0) console.warn('Session Harbor is selected. Legacy bundle cleanup will retry on reconnect.');
    } catch (error) {
      console.warn('Session Harbor is selected. Legacy bundle cleanup failed:', error.message);
    }
  }
}

export const pluginSyncScript = `(${syncPlugin})(${compareVersions}, ...process.argv.slice(1));`;
