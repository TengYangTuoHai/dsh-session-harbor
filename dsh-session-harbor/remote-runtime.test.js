import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeferredNavigation, createDeviceLocaleForm, createDeviceRuntimePool, createRuntimeLayout, nativeRosterOf } from './remote-runtime.js';

test('the embedded locale starts with the workbench language and tracks its changes', async () => {
  let current = { active: 'ja', revision: 1 };
  const listeners = new Set();
  const publish = active => {
    current = { active, revision: current.revision + 1 };
    for (const listener of listeners) listener();
  };
  const locale = {
    getSnapshot: () => current,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setLocale: publish,
  };
  const form = createDeviceLocaleForm(locale);
  const initial = form.getSnapshot();
  assert.equal(initial.value.preference, 'ja');
  const preferences = [];
  const unsubscribe = form.subscribe(() => preferences.push(form.getSnapshot().value.preference));
  publish('ja');
  assert.equal(form.getSnapshot(), initial);
  publish('en');
  assert.deepEqual(preferences, ['en']);
  assert.equal(await form.set('preference', 'fr'), true);
  assert.equal(await form.set('unrelated', 'en'), false);
  assert.deepEqual(preferences, ['en', 'fr']);
  unsubscribe();
  publish('en');
  assert.deepEqual(preferences, ['en', 'fr']);
  assert.equal(form.getSnapshot().value.preference, 'en');
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function descriptor(targetId, generation = 1) {
  return { targetId, connectionId: `conn-${generation}`, runtimeKey: `${targetId}-${generation}`, baseUrl: `/t3-remote/ssh/conn-${generation}/`, graph: { entries: [] } };
}

function runtime(description, log) {
  const bindings = new Map();
  const byId = Object.fromEntries(['same-id', 'session-a', 'remote-session', 's1'].map(id => [id, { sessionId: id }]));
  const instance = {
    descriptor: description, subscriptions: [], abort: new AbortController(), closed: false,
    realm: { active: false, async dispose() { log.push(['realm-dispose', description.runtimeKey]); } },
    connection: { async dispose() { log.push(['connection-dispose', description.runtimeKey]); } },
    ctx: {
      sessions: {
        list: { getSnapshot: () => ({ phase: 'ready', byId }) },
        async refresh() { log.push(['refresh', description.targetId]); byId['new-session'] = { sessionId: 'new-session' }; },
        binding: id => bindings.get(id),
      },
      uiWorkspace: {
        openSession(id) { log.push(['open', description.targetId, id]); bindings.set(id, { sessionId: id }); },
      },
      slots: { renderSlot: () => description.runtimeKey },
      fiber: { async dispose() { log.push(['ctx-dispose', description.runtimeKey]); } },
    },
  };
  return instance;
}

function fixture({ describe = id => descriptor(id), build } = {}) {
  const log = [];
  const built = [];
  const pageGlobal = {};
  const pool = createDeviceRuntimePool({
    context: { modules: { import: () => { throw new Error('The pure runtime model must not load UI modules'); } } },
    describe,
    pageGlobal,
    buildRuntime: async (description, options) => {
      const instance = runtime(description, log);
      built.push(instance);
      return build ? build(instance, options) : instance;
    },
  });
  return { pool, built, log, pageGlobal };
}

test('a session identity remains scoped to its device through open, refresh and disposal', async () => {
  const f = fixture();
  try {
    await f.pool.open({ targetId: 'device-a', sessionId: 'same-id' });
    assert.deepEqual(f.pool.state.getSnapshot().active, { targetId: 'device-a', sessionId: 'same-id' });
    assert.equal(f.pool.render('device-a'), 'device-a-1');
    await f.pool.open({ targetId: 'device-b', sessionId: 'same-id' });
    assert.deepEqual(f.log.filter(row => row[0] === 'open'), [
      ['open', 'device-a', 'same-id'], ['open', 'device-b', 'same-id'],
    ]);
    assert.equal(f.built[0].realm.active, false);
    assert.equal(f.built[1].realm.active, true);
    assert.equal(f.log.some(row => row[0] === 'refresh'), false);
    f.pool.deactivate();
    assert.equal(f.pool.state.getSnapshot().active, null);
    assert.equal(f.built[1].realm.active, false);
  } finally { await f.pool.dispose(); }
  assert.equal(f.built.every(value => value.closed), true);
});

test('a click joins device warmup and later clicks reuse its live catalog', async () => {
  const entered = deferred();
  const finish = deferred();
  const requests = [];
  const f = fixture({
    describe(id) { requests.push(id); return descriptor(id); },
    async build(instance) { entered.resolve(); await finish.promise; return instance; },
  });
  try {
    const warming = f.pool.ensure('device-a', { connectionId: 'conn-1' });
    await entered.promise;
    assert.equal(f.pool.state.getSnapshot().active, null);
    assert.deepEqual(f.log, []);
    const opened = f.pool.open({ targetId: 'device-a', sessionId: 'session-a' }, { connectionId: 'conn-1' });
    finish.resolve();
    await Promise.all([warming, opened]);
    await f.pool.open({ targetId: 'device-a', sessionId: 'same-id' }, { connectionId: 'conn-1' });
    assert.deepEqual(requests, ['device-a']);
    assert.deepEqual(f.log, [['open', 'device-a', 'session-a'], ['open', 'device-a', 'same-id']]);
    await f.pool.open({ targetId: 'device-a', sessionId: 'new-session' }, { connectionId: 'conn-1' });
    assert.deepEqual(f.log.slice(-2), [['refresh', 'device-a'], ['open', 'device-a', 'new-session']]);
    await f.pool.open({ targetId: 'device-a', sessionId: 'session-a' }, { connectionId: 'conn-1', refresh: true });
    assert.deepEqual(requests, ['device-a', 'device-a']);
    assert.deepEqual(f.log.slice(-2), [['refresh', 'device-a'], ['open', 'device-a', 'session-a']]);
    assert.equal(f.built.length, 1);
  } finally { finish.resolve(); await f.pool.dispose(); }
});

test('an open on a reconnected device does not wait for the older warmup', async () => {
  const requested = deferred();
  const firstReply = deferred();
  let generation = 1;
  const f = fixture({ describe(id, { signal }) {
    if (generation === 1) { requested.resolve(signal); return firstReply.promise; }
    return descriptor(id, generation);
  } });
  const warmup = f.pool.ensure('device-a', { connectionId: 'conn-1' });
  const cancelled = assert.rejects(warmup, /connection changed/);
  try {
    const signal = await requested.promise;
    generation = 2;
    await f.pool.open({ targetId: 'device-a', sessionId: 'session-a' }, { connectionId: 'conn-2' });
    assert.equal(signal.aborted, true);
    assert.equal(f.pool.state.getSnapshot().phase, 'ready');
    assert.equal(f.pool.render('device-a'), 'device-a-2');
  } finally {
    firstReply.resolve(descriptor('device-a', 1));
    await cancelled;
    await f.pool.dispose();
  }
});

test('retiring a loading device rejects its late runtime without disposing the replacement', async () => {
  const entered = deferred();
  const oldBuild = deferred();
  let generation = 1;
  const f = fixture({
    describe: id => descriptor(id, generation),
    build: (instance, { signal }) => {
      if (instance.descriptor.runtimeKey === 'device-a-1') {
        entered.resolve(signal);
        return oldBuild.promise.then(() => instance);
      }
      return instance;
    },
  });
  try {
    const old = f.pool.ensure('device-a');
    const oldSignal = await entered.promise;
    await f.pool.retire('device-a');
    assert.equal(oldSignal.aborted, true);
    generation = 2;
    const replacement = await f.pool.ensure('device-a');
    const rejected = assert.rejects(old, /connection changed/);
    oldBuild.resolve();
    await rejected;
    assert.equal(f.built[0].closed, true);
    assert.equal(replacement.closed, false);
    assert.equal(f.pool.render('device-a'), 'device-a-2');
  } finally { oldBuild.resolve(); await f.pool.dispose(); }
});

test('a retired descriptor cannot start building native services after its response arrives', async () => {
  const requested = deferred();
  const reply = deferred();
  const f = fixture({ describe(id, { signal }) { requested.resolve(signal); return reply.promise; } });
  const attempt = f.pool.ensure('device-a');
  const signal = await requested.promise;
  await f.pool.retire('device-a');
  assert.equal(signal.aborted, true);
  const rejected = assert.rejects(attempt, /connection changed/);
  reply.resolve(descriptor('device-a'));
  await rejected;
  assert.equal(f.built.length, 0);
  await f.pool.dispose();
});

test('switching back to the local workspace supersedes a pending remote open', async () => {
  const requested = deferred();
  const reply = deferred();
  const f = fixture({ describe() { requested.resolve(); return reply.promise; } });
  try {
    const opened = f.pool.open({ targetId: 'device-a', sessionId: 'remote-session' });
    await requested.promise;
    f.pool.deactivate();
    reply.resolve(descriptor('device-a'));
    await opened;
    assert.equal(f.pool.state.getSnapshot().active, null);
    assert.equal(f.pool.state.getSnapshot().phase, 'idle');
    assert.equal(f.log.some(row => row[0] === 'open'), false);
    assert.equal(f.built[0].realm.active, false);
  } finally { reply.resolve(descriptor('device-a')); await f.pool.dispose(); }
});

test('native load failure is explicit and retry stays on the requested device', async () => {
  let calls = 0;
  const f = fixture({ describe(id) {
    if (++calls === 1) throw new Error('No verified native Client matches this device');
    return descriptor(id);
  } });
  try {
    await assert.rejects(f.pool.open({ targetId: 'device-a', sessionId: 'session-a' }), /verified native Client/);
    assert.equal(f.pool.state.getSnapshot().phase, 'error');
    assert.equal(f.log.some(row => row[0] === 'open'), false);
    await f.pool.open({ targetId: 'device-a', sessionId: 'session-a' });
    assert.equal(f.pool.state.getSnapshot().phase, 'ready');
    assert.deepEqual(f.log.filter(row => row[0] === 'open'), [['open', 'device-a', 'session-a']]);
  } finally { await f.pool.dispose(); }
});

test('a device connection change disposes only the old native composition', async () => {
  let generation = 1;
  const f = fixture({ describe: id => descriptor(id, generation) });
  try {
    await f.pool.ensure('device-a');
    generation = 2;
    const next = await f.pool.ensure('device-a', { refresh: true });
    assert.equal(f.built[0].closed, true);
    assert.equal(next.closed, false);
    assert.equal(f.pool.render('device-a'), 'device-a-2');
    await f.pool.ensure('device-a', { refresh: true });
    assert.equal(f.built.length, 2, 'the same runtime identity is reused');
  } finally { await f.pool.dispose(); }
});

test('the embedded layout owns its navigation and never redirects the page', () => {
  let toggles = 0;
  const layout = createRuntimeLayout({ sidebar: { toggleSidebar() { toggles++; } }, hasPanel: key => key === 'conversation' });
  const old = layout.beginNavigation();
  layout.selectPanel('conversation');
  assert.equal(old.aborted, true);
  assert.deepEqual(layout.panelInfo.getSnapshot(), { activePanelId: 'conversation' });
  assert.throws(() => layout.selectPanel('unknown'), /Unknown device panel/);
  layout.openRightbar(true, false);
  assert.equal(layout.geometry.getSnapshot().track, true);
  layout.closeRightbar();
  assert.equal(layout.geometry.getSnapshot().track, false);
  layout.toggleSidebar();
  assert.equal(toggles, 1);
  layout.dispose();
});

test('remote rightbar width stays within the conversation bounds and restores the device preference', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const layout = createRuntimeLayout({ storage });
  const width = () => layout.geometry.getSnapshot().rightbarWidth;
  assert.equal(width(), 320);

  layout.openRightbar(true, false);
  layout.previewRightbarWidth(200);
  assert.equal(width(), 300);
  layout.previewRightbarWidth(850);
  assert.equal(width(), 600, 'the conversation keeps at least 400px');
  layout.finishRightbarResize(320);

  layout.openRightbar(true, true);
  layout.previewRightbarWidth(350);
  assert.equal(width(), 600, 'fullscreen cannot change the docked width');
  layout.closeRightbar();
  layout.setViewportWidth(760);
  assert.equal(width(), 360);
  layout.previewRightbarWidth(310);
  assert.equal(width(), 360, 'a hidden track cannot be resized');
  layout.setViewportWidth(1000);
  layout.openRightbar(true, false);
  assert.equal(width(), 600, 'narrow and fullscreen modes preserve the preference');
  assert.equal(createRuntimeLayout({ storage }).geometry.getSnapshot().rightbarWidth, 600);
  assert.equal(createRuntimeLayout().geometry.getSnapshot().rightbarWidth, 320);

  layout.setViewportWidth(2000);
  layout.previewRightbarWidth(1800);
  assert.equal(width(), 1400, 'the panel uses at most 70% of a wide frame');
});

test('a remote rightbar gesture with no net change leaves saved widths intact', () => {
  let saved = '600';
  const storage = { getItem: () => saved, setItem: (_, value) => { saved = value; } };
  const layout = createRuntimeLayout({ storage });

  layout.openRightbar(true, false);
  layout.setViewportWidth(900);
  assert.equal(layout.geometry.getSnapshot().rightbarWidth, 500);
  layout.previewRightbarWidth(450);
  layout.previewRightbarWidth(500);
  layout.finishRightbarResize(500);
  layout.setViewportWidth(1000);
  assert.equal(layout.geometry.getSnapshot().rightbarWidth, 600);

  saved = '550';
  layout.finishRightbarResize(600);
  assert.equal(saved, '550', 'a stationary click does not overwrite a newer preference');
});

test('connection identities replace a ready runtime even when the down snapshot was coalesced', async () => {
  let generation = 1;
  const f = fixture({ describe: id => descriptor(id, generation) });
  try {
    await f.pool.open({ targetId: 'device-a', sessionId: 'session-a' });
    generation = 2;
    await f.pool.ensure('device-a', { connectionId: 'conn-2' });
    assert.equal(f.built[0].closed, true);
    assert.equal(f.pool.state.getSnapshot().phase, 'loading');
    assert.equal(f.built[1].realm.active, false);
    await f.pool.open(f.pool.state.getSnapshot().active);
    assert.equal(f.pool.state.getSnapshot().phase, 'ready');
    assert.equal(f.built[1].realm.active, true);
    assert.equal(f.pool.render('device-a'), 'device-a-2');
  } finally { await f.pool.dispose(); }
});

test('startup waits for an explicit current selection before revealing the workspaces', async () => {
  const calls = [];
  let ready = false;
  let remembered = false;
  const actual = {
    openSession(id) { calls.push(['open', id, ready]); },
    startSession(workspaceId, options) { calls.push(['create', workspaceId, options]); },
  };
  const navigation = createDeferredNavigation({
    context: {},
    startLastNewSession() {
      if (remembered) calls.push(['remembered']);
      return remembered;
    },
    onChooseDevice: () => calls.push(['choose']),
    activate() {
      calls.push(['activate']);
      return { service: actual, showWorkspaces() {
        if (!ready) calls.push(['show']);
        ready = true;
      } };
    },
  });
  assert.deepEqual(calls, []);
  assert.throws(() => navigation.service.startSession(), /Open a device session/);
  await navigation.open('superseded-session', () => false);
  assert.deepEqual(calls, [['activate']]);
  await navigation.open('requested-session');
  await navigation.open('another-session');
  navigation.service.startSession();
  remembered = true;
  navigation.service.startSession();
  navigation.service.startSession('explicit-project');
  navigation.service.startSession(undefined, { agentPreset: 'cordis', clearPreviousDraft: false });
  assert.deepEqual(calls, [
    ['activate'], ['open', 'requested-session', false], ['show'], ['open', 'another-session', true],
    ['choose'], ['remembered'], ['create', 'explicit-project', undefined],
    ['create', undefined, { agentPreset: 'cordis', clearPreviousDraft: false }],
  ]);
});

test('explicit connection identity rejects mismatched descriptors before composition', async () => {
  const f = fixture({ describe: targetId => descriptor(targetId, 1) });
  try {
    await assert.rejects(f.pool.open({ targetId: 'device-a', sessionId: 's1' }, { connectionId: 'conn-2' }), /connection changed/);
    assert.equal(f.built.length, 0);
    await f.pool.open({ targetId: 'device-a', sessionId: 's1' }, { connectionId: 'conn-1' });
    assert.equal(f.pool.state.getSnapshot().phase, 'ready');
  } finally { await f.pool.dispose(); }
});

test('deferred navigation permission effects use the caller context and never activate navigation', () => {
  const seen = [];
  const navigation = createDeferredNavigation({ context: {}, realm: {}, activate: () => { throw new Error('must stay inert'); } });
  const dispose = () => {};
  const callback = () => {};
  const caller = { ctx: { remoteAccess: { whenResourceAccess(...args) { seen.push(args); return dispose; } } } };
  assert.equal(navigation.service.whenAccess.call(caller, 'project-a', 'workspace/rename', callback), dispose);
  assert.deepEqual(seen, [['workspace', 'project-a', 'workspace/rename', callback]]);
});

test('native feature roster excludes the outer application but retains conversation features', () => {
  const ids = ['dsh-client-ui-layout', 'dsh-client-ui-sidebar', 'dsh-client-connection', 'dsh-client-modules',
    'dsh-client-ui-renderer', 'dsh-client-ui-chat', 'dsh-client-ui-approval', 'dsh-client-file-upload'];
  const roster = nativeRosterOf({ entries: ids.map(id => ({ id: '@deepseek-ai/' + id })) });
  assert.deepEqual(roster.map(row => row.id), [
    '@deepseek-ai/dsh-client-ui-renderer', '@deepseek-ai/dsh-client-ui-chat',
    '@deepseek-ai/dsh-client-ui-approval', '@deepseek-ai/dsh-client-file-upload',
  ]);
});
