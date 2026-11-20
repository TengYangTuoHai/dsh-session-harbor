import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const languages = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'];
const placeholders = text => (text.match(/\{[\w]+\}/g) ?? []).sort();

const noop = () => {};

function loadClient({ list = noop, openSession = noop } = {}) {
  const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
  const registered = new Map();
  let notice;
  const createElement = (type, props, ...children) => ({ type, props, children });
  const window = {
    localStorage: { getItem: () => null },
    __ModuleLoader__: {
      load({ factory }) {
        const plugin = factory(name => name === 'react' ? { createElement } : {});
        plugin.apply({
          effect: setup => setup(),
          locale: {
            register: (namespace, dictionaries) => registered.set(namespace, dictionaries),
            bind: noop,
            getSnapshot: noop,
            subscribe: noop,
          },
          slots: {
            inject: (name, register) => { if (name === 'conversation.input.dock') register(); },
            register: (options, component) => { notice = { options, component }; },
          },
          get: name => name === 'remote.commands' ? { list } : undefined,
          uiWorkspace: { openSession },
          contextMenus: { register: noop },
        });
      },
    },
  };
  runInNewContext(source, { window }, { filename: 'client.js' });
  return { dictionaries: registered, notice };
}

test('each DSH language has a complete sidebar and SSH dictionary', () => {
  const { dictionaries } = loadClient();
  for (const namespace of ['t3-session-sidebar', 't3-ssh']) {
    const copy = dictionaries.get(namespace);
    assert.ok(copy, namespace);
    assert.deepEqual(Object.keys(copy).sort(), languages, namespace);
    const english = copy.en;
    const keys = Object.keys(english).sort();
    for (const language of languages) {
      const localized = copy[language];
      assert.deepEqual(Object.keys(localized).sort(), keys, `${namespace}:${language}`);
      for (const key of keys) {
        const location = `${namespace}:${language}:${key}`;
        assert.equal(typeof localized[key], 'string', location);
        assert.ok(localized[key].trim(), location);
        assert.deepEqual(placeholders(localized[key]), placeholders(english[key]), location);
      }
    }
  }
});

test('each DSH language has plugin inventory metadata', () => {
  for (const language of languages) {
    const url = new URL(`./locale/${language}.json`, import.meta.url);
    const { meta } = JSON.parse(readFileSync(url, 'utf8'));
    assert.equal(meta.title, 'Session Harbor', language);
    assert.ok(meta.description.trim(), language);
  }
});


test('the writer notice belongs to the affected session and handles background activation failures', () => {
  const { notice } = loadClient();
  const sessionId = 'locked-session';
  const render = state => notice.component({ sessionId, useSession: select => select({ sessionId, ...state }) });
  const message = `session "${sessionId}" is already owned by an active write handle`;
  const failure = { code: 'session/writer-held' };
  assert.equal(render({ openState: 'open', lastAgentError: message }).props.conflict, message);
  assert.equal(render({ openError: failure }).props.conflict, failure);
  assert.equal(render({ promptError: { error: failure } }).props.conflict, failure);
  assert.equal(render({ lastAgentError: message.replace(sessionId, 'another-session') }), null);
  assert.equal(render({ openError: { code: 'session/not-found' } }), null);
  assert.equal(render({ openState: 'open' }), null);
});

test('retry reopens only its own session after the host resolves its Agent', async () => {
  const opened = [];
  const probed = [];
  const conflict = { ok: false, error: { code: 'session/writer-held' } };
  let response = conflict;
  const { notice } = loadClient({
    list: async sessionId => { probed.push(sessionId); return response; },
    openSession: sessionId => opened.push(sessionId),
  });
  const sessionId = 'locked-session';
  const { retryOpen } = notice.options.inject(sessionId);
  assert.equal(await retryOpen(new AbortController().signal), conflict);
  assert.deepEqual(opened, []);
  response = { ok: true, value: [] };
  const controller = new AbortController();
  const cancelled = retryOpen(controller.signal);
  controller.abort();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.deepEqual(opened, []);
  assert.equal(await retryOpen(new AbortController().signal), response);
  assert.deepEqual(probed, [sessionId, sessionId, sessionId]);
  assert.deepEqual(opened, [sessionId]);
});
