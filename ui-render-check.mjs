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
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body>', { pretendToBeVisual: true });
const loaded = {};
dom.window.__ModuleLoader__ = { load(spec) { loaded.factory = spec.factory; } };
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// react-dom chooses its text-input strategy — the real `input` event or the IE
// polyfill — while it is being required, so the DOM has to exist before it.
const React = nodeRequire(pick('react'));
const reactDom = pick('react-dom');
const ReactDOMClient = nodeRequire(path.join(reactDom, 'client.js'));
const { act } = nodeRequire(path.join(reactDom, 'test-utils.js'));
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
// Every row keeps the same shape: a workspace line over a title line, settled included.
const rowShapes = [...document.querySelectorAll('.t3-row')].map(row => (row.querySelector('.t3-top') ? 'top' : 'NOTOP')
  + (row.querySelector('.t3-line') ? '+line' : 'NOLINE') + (row.querySelector('.t3-proj') ? '+proj' : 'NOPROJ'));
console.log('row shapes:', [...new Set(rowShapes)].join(' | '), '| rows:', rowShapes.length);
console.log('rows before expanding Settled:', [...document.querySelectorAll('.t3-row')].map(row => row.dataset.current === 'true' ? 'current' : 'plain').join(', '));
// The header search is the native control: one 28px button until it is opened,
// then the title folds away, the frame grows around the field, and the caret
// lands in it. Escape clears the filter and folds the field back.
const searchState = () => ({
  expanded: document.querySelector('.t3-search-button').getAttribute('aria-expanded'),
  tab: document.querySelector('.t3-search-input').tabIndex,
  clear: document.querySelectorAll('.t3-clear').length,
  hidden: document.querySelector('.t3-title').dataset.hidden,
  focused: document.activeElement === document.querySelector('.t3-search-input'),
  rows: document.querySelectorAll('.t3-row').length,
  actions: document.querySelector('.t3-header-actions').dataset.hidden,
  actionButtons: document.querySelectorAll('.t3-header-action').length,
});
const closed = searchState();
await act(async () => { document.querySelector('.t3-search-button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const open = searchState();
await act(async () => {
  const input = document.querySelector('.t3-search-input');
  // React remembers the value it wrote, so an assignment alone reads as no
  // change to its onChange; reset the tracker the way a keystroke would.
  input.value = 'rename';
  input._valueTracker.setValue('');
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const filtered = [...document.querySelectorAll('.t3-row .t3-open')].map(node => node.textContent);
// A click outside the control keeps a live filter, exactly as the native header
// does; only Escape folds it away.
await act(async () => { document.body.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
const outsideClick = { ...searchState(), rows: document.querySelectorAll('.t3-row').length };
await act(async () => { document.querySelector('.t3-search-input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
const escaped = searchState();
console.log('search closed:', JSON.stringify(closed), '| open:', JSON.stringify(open));
console.log('filtered by "rename":', filtered.join(', '), '| outside click:', JSON.stringify(outsideClick), '| escape:', JSON.stringify(escaped));
// Exactly one shelf header carries the push, and it is the first shelf.
const shelves = [...document.querySelectorAll('.t3-group[data-shelf=true]')];
console.log('shelf groups:', shelves.map(node => [...node.querySelectorAll('.t3-heading')][0]?.textContent).join(', '));
await act(async () => { heading('settled').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
for (const row of document.querySelectorAll('.t3-row')) {
  console.log('--- row' + (row.dataset.current === 'true' ? ' (current)' : '') + (row.dataset.working === 'true' ? ' (working)' : ''));
  console.log(row.innerHTML.replace(/<svg[\s\S]*?<\/svg>/g, '[svg]').replace(/></g, '>\n  <'));
}
// A live run names itself in the trailing slot instead of showing an age, and the
// row keeps data-working as a state hook; the settled row keeps the plain age.
const live = [...document.querySelectorAll('.t3-row[data-working=true] .t3-live')];
console.log('working rows:', document.querySelectorAll('.t3-row[data-working=true]').length,
  '| live labels:', live.map(node => node.textContent).join(' / '));
const rules = document.styleSheets[0]?.cssRules ? [...document.styleSheets[0].cssRules] : [];
console.log('parsed css rules:', rules.length, '| media:', rules.filter(rule => rule.type === 4).map(rule => rule.conditionText + ' {' + rule.cssRules.length + '}').join(', '));
// T3 Code only emits the Working shelf when something is working, and the Pinned
// header only when something is pinned. Mount a second sidebar with nothing
// running and nothing pinned: those headings must be gone, and the shelf push
// must have moved to Settled.
const idleHost = dom.window.document.createElement('div');
idleHost.id = 'idle';
dom.window.document.body.appendChild(idleHost);
const idleList = { ids: list.ids, byId: Object.fromEntries(Object.entries(list.byId).map(([id, s]) => [id, { ...s, running: false }])) };
const idleStatuses = new Map([...statuses].map(([id]) => [id, { running: false, pendingInteraction: undefined, completionUnread: false }]));
// Hoisted: the hook compares by identity, so a fresh literal per render loops.
const idleWorkspaces = { ...workspaces, pinnedSessionIds: [] };
await act(async () => {
  ReactDOMClient.createRoot(idleHost).render(React.createElement(Sidebar, {
    wide: true,
    expandSidebar: () => {},
    useSessions: select => select(idleList),
    useSessionStatus: select => select(idleStatuses),
    useWorkspaces: select => select(idleWorkspaces),
    usePanelInfo: select => select({ activePanelId: null }),
    useContextMenu: () => ({ getTriggerProps: (_target, extra) => extra ?? {} }),
    renderFactorySlot: (name, props) => React.createElement('i', { 'data-slot': name, 'data-label': props.label }),
    t: key => key,
  }));
});
const idleHeadings = [...idleHost.querySelectorAll('.t3-heading')].map(node => node.textContent.trim());
const idleShelf = [...idleHost.querySelectorAll('.t3-group[data-shelf=true] .t3-heading')].map(node => node.textContent.trim());
console.log('idle sidebar headings:', idleHeadings.join(' | '), '| shelf:', idleShelf.join(', '));
// The preview page re-runs the fill measurement on static markup, so the two
// must not drift: pin the plugin side to the same pieces.
const source = await import('node:fs').then(fs => fs.readFileSync(path.join(here, 't3-session-sidebar', 'client.js'), 'utf8'));
const fillPieces = ['--t3-fill', 'overflowY', 'area.clientHeight - offset', 'ResizeObserver'];
const missing = fillPieces.filter(piece => !source.includes(piece));
console.log('fill measurement pieces:', missing.length ? 'MISSING ' + missing.join(', ') : 'all present');
// Two running sessions: the pinned one and the Working group's one.
process.exit(live.length === 2 && live.every(node => /statusOngoing/.test(node.textContent))
  && shelves.length === 1 && shelves[0].textContent.includes('working')
  && idleHeadings.length === 2 && !idleHeadings.join(' ').includes('working') && !idleHeadings.join(' ').includes('pinned')
  && idleShelf.length === 1 && idleShelf[0].includes('settled')
  && missing.length === 0
  // Search: folded to one button, opened into a focused field with a clear
  // button, filtering live, surviving an outside click, folded by Escape.
  && closed.expanded === 'false' && closed.tab === -1 && closed.clear === 0 && closed.hidden === 'false' && !closed.focused
  // The native header's two trailing buttons are seated, and fold away with the title.
  && closed.actionButtons === 2 && closed.actions === 'false' && open.actions === 'true' && escaped.actions === 'false'
  && open.expanded === 'true' && open.tab === 0 && open.clear === 1 && open.hidden === 'true' && open.focused && open.rows === closed.rows
  && filtered.length === 1 && /Rename settle group/.test(filtered.join(' '))
  && outsideClick.expanded === 'true' && outsideClick.rows === 1 && !outsideClick.focused
  && escaped.expanded === 'false' && escaped.clear === 0 && escaped.hidden === 'false'
  ? 0 : 1);
