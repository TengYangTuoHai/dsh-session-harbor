import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ConnectionManager } from './ssh/connection-manager.js';
import { createSshSettingsHandler } from './ssh/host.js';
import { pluginName, pluginVersion } from './ssh/plugin-sync.js';

// Execute the actual SSH wrapper with a fixture that stands in for DSH and pnpm.
const fakeDsh = `#!/usr/bin/env node
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const args = process.argv.slice(2);
const [command] = args;
const env = process.env;
const trace = value => appendFileSync(env.HARBOR_TEST_TRACE, JSON.stringify(value) + '\\n');
if (command === 'plugin') {
  assert.deepEqual(args.slice(0, 6), ['plugin', '--profile', env.HARBOR_TEST_PROFILE, 'exec', 'node', '-e']);
  assert.equal(env.PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN, 'false');
  assert.equal(env.npm_config_verify_deps_before_run, 'false');
  assert.equal(process.cwd(), env.HARBOR_TEST_CWD);
  const result = spawnSync(process.execPath, args.slice(5), {
    cwd: env.HARBOR_TEST_PROFILE_DIR, env: { ...env, npm_execpath: process.argv[1] }, stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
} else if (command === 'add' || command === 'remove') {
  const [, spec, ...flags] = args;
  assert.ok(flags.includes('--ignore-scripts'));
  trace([command, spec]);
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
  if (command === 'add') {
    assert.ok(flags.includes('--save-exact'));
    if (env.HARBOR_TEST_FAIL_ADD === '1') process.exit(1);
    const [name, version] = spec.split('@');
    const directory = join('node_modules', name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }));
    manifest.dependencies ??= {};
    manifest.dependencies[name] = version;
  } else {
    assert.ok(!manifest.dsh.profile.bundles.includes(spec), 'legacy is inactive before unlinking');
    assert.ok(manifest.dsh.profile.bundles.includes('dsh-session-harbor'));
    if (env.HARBOR_TEST_FAIL_REMOVE === '1') process.exit(1);
    delete manifest.dependencies[spec];
    rmSync(join('node_modules', spec), { recursive: true, force: true });
  }
  writeFileSync('package.json', JSON.stringify(manifest));
} else {
  assert.equal(process.cwd(), env.HARBOR_TEST_CWD);
  assert.deepEqual(args.slice(0, 2), ['--profile', env.HARBOR_TEST_PROFILE]);
  assert.equal(env.DSH_SESSION_HARBOR_SSH_HOST, '1');
  trace(['start']);
  process.stdout.write('dsh web: http://127.0.0.1:12345/?token=fixture\\n');
  setInterval(() => {}, 1000);
}
`;

const legacyName = '@local/dsh-t3-session-sidebar';

async function fixture(t, { installed, legacy, fail = false, failRemove = false }) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'harbor-ssh-')));
  const path = join(root, "dsh's executable");
  const cwd = await mkdir(join(root, "device's workspace"), { recursive: true });
  const profileDir = await mkdir(join(root, 'profile'), { recursive: true });
  const profile = "web's profile";
  const trace = join(root, 'trace.jsonl');
  const manifestPath = join(profileDir, 'package.json');
  const manifest = { dependencies: {}, dsh: { profile: { bundles: ['base', ...(legacy ? [legacyName] : []), 'web'] } } };
  for (const [name, version] of [[pluginName, installed], [legacyName, legacy]]) {
    if (!version) continue;
    const directory = join(profileDir, 'node_modules', name);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version }));
    manifest.dependencies[name] = version;
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(path, fakeDsh, { mode: 0o700 });
  const manager = new ConnectionManager({
    allocatePort: async () => 43210,
    spawn: (_file, args, options) => args.includes('-N')
      ? spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], options)
      : spawn('/bin/sh', ['-c', args.at(-1)], { ...options, env: {
        ...process.env, SHELL: '/bin/sh', HARBOR_TEST_PROFILE: profile, HARBOR_TEST_CWD: cwd,
        HARBOR_TEST_PROFILE_DIR: profileDir, HARBOR_TEST_TRACE: trace,
        HARBOR_TEST_FAIL_ADD: String(Number(fail)), HARBOR_TEST_FAIL_REMOVE: String(Number(failRemove)),
      } }),
    fetch: async () => new Response(null, {
      status: 303, headers: { location: './', 'set-cookie': ['dsh-auth-fixture', 'test; HttpOnly'].join('=') },
    }),
  });
  t.after(async () => {
    await manager.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const { id } = manager.connect({ host: 'test-device', dshPath: path, profile, cwd });
  const connection = await manager.waitConnected(id).catch(error => {
    throw new Error(manager.get(id).logs.join('\n'), { cause: error });
  });
  const events = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  return { connection, events, manager, manifest: JSON.parse(await readFile(manifestPath, 'utf8')) };
}

const install = ['add', `${pluginName}@${pluginVersion}`];
for (const { name, installed, expected } of [
  { name: 'installs a missing plugin', expected: [install, ['start']] },
  { name: 'upgrades an older plugin', installed: '0.0.1', expected: [install, ['start']] },
  { name: 'skips the same version', installed: pluginVersion, expected: [['start']] },
  { name: 'keeps a newer remote version', installed: '9999.0.0', expected: [['start']] },
]) {
  test(`SSH ${name} before starting the remote host`, async t => {
    const { connection, events } = await fixture(t, { installed });
    assert.deepEqual(events, expected);
    assert.equal(connection.pluginSyncFailedVersion, undefined);
  });
}

test('SSH installs and selects Session Harbor before removing the legacy package', async t => {
  const { events, manifest, connection } = await fixture(t, { legacy: '0.2.3' });
  assert.deepEqual(events, [install, ['remove', legacyName], ['start']]);
  assert.deepEqual(manifest.dsh.profile.bundles, ['base', pluginName, 'web']);
  assert.deepEqual(manifest.dependencies, { [pluginName]: pluginVersion });
  assert.equal(connection.pluginSyncFailedVersion, undefined);
});

test('failed replacement install leaves the legacy package selected', async t => {
  const { events, manifest, connection } = await fixture(t, { legacy: '0.2.3', fail: true });
  assert.deepEqual(events, [install, ['start']]);
  assert.deepEqual(manifest.dsh.profile.bundles, ['base', legacyName, 'web']);
  assert.deepEqual(manifest.dependencies, { [legacyName]: '0.2.3' });
  assert.equal(connection.pluginSyncFailedVersion, pluginVersion);
});

test('legacy migration reuses a staged newer version and tolerates a cleanup failure', async t => {
  const { events, manifest, connection } = await fixture(t, { legacy: '0.2.3', installed: '9999.0.0', failRemove: true });
  assert.deepEqual(events, [['remove', legacyName], ['start']]);
  assert.deepEqual(manifest.dsh.profile.bundles, ['base', pluginName, 'web']);
  assert.deepEqual(manifest.dependencies, { [legacyName]: '0.2.3', [pluginName]: '9999.0.0' });
  assert.equal(connection.pluginSyncFailedVersion, undefined);
});

test('a newer legacy package remains selected when the replacement would be older', async t => {
  const { events, manifest } = await fixture(t, { legacy: '9999.0.0' });
  assert.deepEqual(events, [['start']]);
  assert.deepEqual(manifest.dsh.profile.bundles, ['base', legacyName, 'web']);
});

test('a plugin install failure leaves the SSH connection usable and surfaces the warning', async t => {
  const { connection, events, manager } = await fixture(t, { fail: true });
  assert.deepEqual(events, [install, ['start']]);
  const settings = createSshSettingsHandler({ admit: () => ({ peer: { principal: { kind: 'owner' } } }) }, () => ({
    snapshot: () => ({ config: { hosts: [] }, targets: [], connections: manager.list() }),
  }));
  let payload;
  await settings({ method: 'GET' }, {
    writeHead(status) { assert.equal(status, 200); },
    end(body) { payload = JSON.parse(body); },
  });
  assert.equal(payload.connections[0].status, 'connected');
  assert.equal(payload.connections[0].pluginSyncFailedVersion, pluginVersion);
  assert.equal((await manager.disconnect(connection.id)).pluginSyncFailedVersion, undefined);
});
