import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const languages = ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'];
const placeholders = text => (text.match(/\{[\w]+\}/g) ?? []).sort();

function registeredDictionaries() {
  const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
  const registered = new Map();
  const noop = () => {};
  const window = {
    localStorage: { getItem: () => null },
    __ModuleLoader__: {
      load({ factory }) {
        const plugin = factory(() => ({}));
        plugin.apply({
          effect: setup => setup(),
          locale: {
            register: (namespace, dictionaries) => registered.set(namespace, dictionaries),
            bind: noop,
            getSnapshot: noop,
            subscribe: noop,
          },
          slots: { inject: noop },
          contextMenus: { register: noop },
        });
      },
    },
  };
  runInNewContext(source, { window }, { filename: 'client.js' });
  return registered;
}

test('each DSH language has a complete sidebar and SSH dictionary', () => {
  const dictionaries = registeredDictionaries();
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
