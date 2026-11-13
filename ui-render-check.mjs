// Offline render check for the sidebar rows: mounts the plugin's client module in
// jsdom with fake DSH slot props and prints the row markup, so the T3-style layout
// can be reviewed without the app. It borrows react, react-dom and jsdom from a
// DSH checkout (pnpm store), because this plugin ships no client test dependencies:
//   node ui-render-check.mjs
//   DSH_CHECKOUT=/path/to/deepseek-harness node ui-render-check.mjs
import { createRequire } from 'node:module';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = process.env.DSH_CHECKOUT ?? '/Volumes/T7-1T/dev/code/deepseek-harness';
const pnpm = path.join(checkout, 'node_modules', '.pnpm');
const nodeRequire = createRequire(path.join(checkout, 'package.json'));
const pick = (name) => {
  const dir = readdirSync(pnpm).filter(entry => entry.startsWith(name)).sort().at(-1);
  if (!dir) throw new Error(`no ${name}* package under ${pnpm}`);
  return path.join(pnpm, dir, 'node_modules', name);
};
const { JSDOM } = nodeRequire(pick('jsdom'));
const React = nodeRequire(pick('react'));
const reactDom = pick('react-dom');
const ReactDOMClient = nodeRequire(path.join(reactDom, 'client.js'));
const { act } = nodeRequire(path.join(reactDom, 'test-utils.js'));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body>', { pretendToBeVisual: true });
const loaded = {};
dom.window.__ModuleLoader__ = { load(spec) { loaded.factory = spec.factory; } };
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

await import(path.join(here, 't3-session-sidebar', 'client.js'));
const plugin = loaded.factory((name) => {
  if (name === 'react') return React;
  throw new Error('unexpected client require: ' + name);
});

// Only the sidebar slot and the locale/connection surfaces the component touches.
const registered = [];
plugin.apply({
  effect(fn) { return fn(); },
  locale: { register() {}, bind: () => key => key },
  slots: {
    inject: (name, factory) => { if (name === 'sidebar.workspaces') registered.push(factory()); return () => {}; },
    register: (spec, component) => ({ spec, component }),
  },
  contextMenus: { register: () => () => {}, notify: () => {} },
  connection: {
    rpc: {
      call: async () => ({
        ok: true,
        value: { epoch: 'check', revision: 1, placements: { c: { settled: true, settledAt: Date.now() - 172800000, unsettledAt: null } } },
      }),
    },
  },
});
const Sidebar = registered[0].component;

const now = Date.now();
const list = {
  ids: ['a', 'b', 'c', 'd', 'e'],
  byId: {
    a: { id: 'a', displayTitle: 'Inspect Network Bridge Contract', cwd: '/repo/dsh-t3-code', running: true, blank: false, updatedAt: now - 9 * 3600000, retainedBy: { mainView: 1 } },
    b: { id: 'b', displayTitle: 'Rename settle group', cwd: '/repo/other', running: false, blank: false, updatedAt: now - 3 * 60000, retainedBy: {} },
    c: { id: 'c', displayTitle: 'Old settled thread', cwd: '/repo/other', running: false, blank: false, updatedAt: now - 2 * 86400000, retainedBy: {} },
    d: { id: 'd', displayTitle: 'Needs a decision', cwd: '/repo/other', running: false, blank: false, updatedAt: now - 30 * 60000, retainedBy: {} },
    e: { id: 'e', displayTitle: 'Refactor thread inbox sync', cwd: '/repo/dsh-t3-code', running: true, blank: false, updatedAt: now - 39 * 60000, retainedBy: {} },
  },
};
const statuses = new Map([
  ['a', { running: true, pendingInteraction: undefined, completionUnread: false }],
  ['b', { running: false, pendingInteraction: undefined, completionUnread: true }],
  ['c', { running: false, pendingInteraction: undefined, completionUnread: false }],
  ['d', { running: false, pendingInteraction: { key: 'k', kind: 'approval', sessionId: 'd' }, completionUnread: false }],
  ['e', { running: true, pendingInteraction: undefined, completionUnread: false }],
]);
const workspaces = {
  items: [{ workspaceId: 'w1', title: 'dsh-t3-code', path: '/repo/dsh-t3-code', sessionIds: ['a'] }],
  pinnedSessionIds: ['a'],
  archivedSessionIds: [],
};

const root = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => {
  root.render(React.createElement(Sidebar, {
    wide: true,
    expandSidebar: () => {},
    useSessions: select => select(list),
    useSessionStatus: select => select(statuses),
    useWorkspaces: select => select(workspaces),
    usePanelInfo: select => select({ activePanelId: null }),
    useContextMenu: () => ({ getTriggerProps: (_target, extra) => extra ?? {} }),
    renderFactorySlot: (name, props) => React.createElement('i', { 'data-slot': name, 'data-label': props.label }),
    t: key => key,
  }));
});

const heading = text => [...document.querySelectorAll('.t3-heading')].find(node => node.textContent.includes(text));
console.log('groups:', [...document.querySelectorAll('.t3-heading')].map(node => node.textContent).join(' | '));
console.log('rows before expanding Settled:', [...document.querySelectorAll('.t3-row')].map(row => row.dataset.variant).join(', '));
await act(async () => { heading('settled').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
for (const row of document.querySelectorAll('.t3-row')) {
  console.log('--- ' + row.dataset.variant + (row.dataset.current === 'true' ? ' (current)' : ''));
  console.log(row.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '[svg]').replace(/></g, '>\n  <'));
}
// A live run names itself in the trailing slot instead of showing an age, and
// its row carries the tint hook; the settled row keeps the plain age.
const live = [...document.querySelectorAll('.t3-row[data-working=true] .t3-live')];
console.log('working rows:', document.querySelectorAll('.t3-row[data-working=true]').length,
  '| live labels:', live.map(node => node.textContent).join(' / '));
const rules = document.styleSheets[0]?.cssRules ? [...document.styleSheets[0].cssRules] : [];
console.log('parsed css rules:', rules.length, '| media:', rules.filter(rule => rule.type === 4).map(rule => rule.conditionText + ' {' + rule.cssRules.length + '}').join(', '));
// Two running sessions: the pinned one and the Working group's one.
process.exit(live.length === 2 && live.every(node => /statusOngoing/.test(node.textContent)) ? 0 : 1);
