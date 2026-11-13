// Scratch visual check: renders the plugin's row markup + CSS in headless Chromium
// with the DSH dark palette, screenshots the resting and hover states, and clicks
// the ellipsis trigger to prove the hover action strip is actually hit-testable.
import { createRequire } from 'node:module';
import { readdirSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const checkout = process.env.DSH_CHECKOUT ?? '/Volumes/T7-1T/dev/code/deepseek-harness';
const pnpm = path.join(checkout, 'node_modules', '.pnpm');
const nodeRequire = createRequire(path.join(checkout, 'package.json'));
const pick = (name) => {
  const dir = readdirSync(pnpm).filter(entry => entry.startsWith(name)).sort().at(-1);
  if (!dir) throw new Error('no ' + name + '* package under ' + pnpm);
  return path.join(pnpm, dir, 'node_modules', name);
};
const { JSDOM } = nodeRequire(pick('jsdom'));
const React = nodeRequire(pick('react'));
const reactDom = pick('react-dom');
const ReactDOMClient = nodeRequire(path.join(reactDom, 'client.js'));
const { act } = nodeRequire(path.join(reactDom, 'test-utils.js'));
const { chromium } = nodeRequire(pick('playwright-core'));

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body>', { pretendToBeVisual: true });
const loaded = {};
dom.window.__ModuleLoader__ = { load(spec) { loaded.factory = spec.factory; } };
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

await import(path.join(here, 't3-session-sidebar', 'client.js'));
const plugin = loaded.factory((name) => {
  if (name === 'react') return React;
  throw new Error('unexpected require ' + name);
});
const registered = [];
const now = Date.now();
const placements = { c: { settled: true, settledAt: now - 172800000, unsettledAt: null } };
plugin.apply({
  effect(fn) { return fn(); },
  locale: { register() {}, bind: () => key => key },
  slots: {
    inject: (name, factory) => { if (name === 'sidebar.workspaces') registered.push(factory()); return () => {}; },
    register: (spec, component) => ({ spec, component }),
  },
  contextMenus: { register: () => () => {}, notify: () => {} },
  connection: { rpc: { call: async () => ({ ok: true, value: { epoch: 'check', revision: 1, placements } }) } },
});

const dict = {
  pinned: '已置顶', active: '活跃', working: '工作中', settled: '已完成',
  pin: '置顶', unpin: '取消置顶', settle: '完成', unsettle: '重新激活', more: '会话操作',
  timeNow: '刚刚', timeMinutes: '{n}分钟', timeHours: '{n}小时', timeDays: '{n}天',
  statusOngoing: '工作中', statusWarning: '等待你操作', statusDone: '已完成',
};
const list = {
  ids: ['a', 'b', 'c', 'd'],
  byId: {
    a: { id: 'a', displayTitle: 'Inspect Network Bridge Contract', cwd: '/repo/dsh-t3-code', running: true, blank: false, updatedAt: now - 9 * 3600000, retainedBy: { mainView: 1 } },
    b: { id: 'b', displayTitle: 'Rename settle group', cwd: '/repo/other', running: false, blank: false, updatedAt: now - 3 * 60000, retainedBy: {} },
    c: { id: 'c', displayTitle: 'Old settled thread', cwd: '/repo/other', running: false, blank: false, updatedAt: now - 2 * 86400000, retainedBy: {} },
    d: { id: 'd', displayTitle: 'Needs a decision', cwd: '/repo/other', running: false, blank: false, updatedAt: now - 30 * 60000, retainedBy: {} },
  },
};
const statuses = new Map([
  ['a', { running: true, pendingInteraction: undefined, completionUnread: false }],
  ['b', { running: false, pendingInteraction: undefined, completionUnread: true }],
  ['c', { running: false, pendingInteraction: undefined, completionUnread: false }],
  ['d', { running: false, pendingInteraction: { key: 'k', kind: 'approval', sessionId: 'd' }, completionUnread: false }],
]);
const workspaces = { items: [{ workspaceId: 'w1', title: 'dsh-t3-code', path: '/repo/dsh-t3-code', sessionIds: ['a'] }], pinnedSessionIds: ['a'], archivedSessionIds: [] };

const root = ReactDOMClient.createRoot(document.getElementById('root'));
await act(async () => {
  root.render(React.createElement(registered[0].component, {
    wide: true,
    expandSidebar: () => {},
    useSessions: select => select(list),
    useSessionStatus: select => select(statuses),
    useWorkspaces: select => select(workspaces),
    usePanelInfo: select => select({ activePanelId: null }),
    useContextMenu: () => ({ getTriggerProps: (_t, extra) => extra ?? {} }),
    // Same DOM contract as the host's contextMenu.button factory: the trigger
    // attribute, the expanded flag, and pointer/click isolation.
    renderFactorySlot: (_name, props) => React.createElement('button', {
      type: 'button',
      className: props.className,
      'data-context-menu-trigger': '',
      'aria-label': props.label,
      'aria-haspopup': 'menu',
      'aria-expanded': false,
      onPointerDown: event => event.stopPropagation(),
      onClick: event => event.stopPropagation(),
    }, '\u22ef'),
    t: (key) => dict[key] ?? key,
  }));
});
await act(async () => {
  const heading = [...document.querySelectorAll('.t3-heading')].find(node => node.textContent.includes(dict.settled));
  heading.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
});

const css = document.querySelector('style').textContent;
const body = document.querySelector('.t3-scroll').outerHTML;
console.log('markup check:', /data-context-menu-trigger/.test(body) ? 'trigger present' : 'TRIGGER MISSING');

const palette = {
  '--dsw-alias-label-primary': '#f9fafb',
  '--dsw-alias-label-secondary': '#cfd3d6',
  '--dsw-alias-label-tertiary': '#adb2b8',
  '--dsw-alias-label-caption': '#81858c',
  '--dsw-alias-interactive-bg-hover': '#ffffff14',
  '--dsw-alias-interactive-bg-active': '#ffffff24',
  '--dsw-alias-state-success-primary': '#22c55e',
  '--dsw-alias-state-warn-primary': '#f59e0b',
  '--dsw-alias-bg-layer-2': '#2c2c2e',
  '--dsw-alias-brand-primary': '#f9fafb',
  '--dsw-alias-border-l1': '#ffffff1f',
};
// Stands in for the host menu overlay: a portal popup anchored at the trigger's
// bottom-left, plus the expanded flag the row keys its hover state on.
const driver = `<script>
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-context-menu-trigger]');
    if (!trigger) return;
    trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.setAttribute('role', 'menu');
    menu.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.bottom + 'px;background:#232324;border:1px solid #ffffff24;border-radius:8px;padding:6px;color:#f9fafb;font-size:12px;z-index:10';
    menu.textContent = '置顶 / 完成 / 重命名 / 归档';
    document.body.appendChild(menu);
  });
</script>`;
const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#151517;'
  + Object.entries(palette).map(([k, v]) => k + ':' + v).join(';')
  + ';font-family:-apple-system,"PingFang SC",sans-serif;}'
  + '.frame{width:296px;padding:10px}' + css + '</style></head><body><div class="frame">' + body + '</div>' + driver + '</body></html>';

const outDir = path.join(here, '.preview');
mkdirSync(outDir, { recursive: true });
// Reuse a Playwright-managed Chromium when one is cached; otherwise let
// playwright-core resolve its own download.
const cached = readdirSync(path.join(process.env.HOME, 'Library/Caches/ms-playwright'))
  .filter(name => name.startsWith('chromium_headless_shell-'))
  .sort()
  .at(-1);
const executable = cached && readdirSync(path.join(process.env.HOME, 'Library/Caches/ms-playwright', cached))
  .map(dir => path.join(process.env.HOME, 'Library/Caches/ms-playwright', cached, dir, 'chrome-headless-shell'))
  .find(file => existsSync(file));
const browser = await chromium.launch(executable ? { executablePath: executable } : {});
const page = await browser.newPage({ viewport: { width: 340, height: 520 }, deviceScaleFactor: 2 });
await page.setContent(html);
console.log('chromium dom:', await page.evaluate(() => document.querySelectorAll('.t3-row').length + ' rows, ' + document.querySelectorAll('[data-context-menu-trigger]').length + ' triggers, ' + document.querySelectorAll('.t3-actions').length + ' strips'));
await page.screenshot({ path: path.join(outDir, 'rows-rest.png') });
await page.hover('.t3-row');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(outDir, 'rows-hover.png') });

const trigger = page.locator('.t3-row [data-context-menu-trigger]').first();
const box = await trigger.boundingBox();
const hit = await page.evaluate(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  return el ? el.className + '|' + el.tagName : 'none';
}, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
await trigger.click();
await page.waitForTimeout(150);
// The pointer leaves for the popup: the row must keep its strip revealed while
// its own menu is open, the way the native row's .menuOpen class does.
await page.mouse.move(320, 500);
await page.waitForTimeout(200);
console.log('strip while menu is open:', await page.evaluate(() => {
  const actions = document.querySelector('.t3-row .t3-actions');
  const style = getComputedStyle(actions);
  return style.position + ' opacity=' + style.opacity + ' pointerEvents=' + style.pointerEvents;
}));
const opened = await page.evaluate(() => document.querySelectorAll('[role="menu"]').length);
await page.screenshot({ path: path.join(outDir, 'rows-menu.png') });
console.log('element under the ellipsis:', hit);
console.log('menus open after the click:', opened);
await browser.close();
process.exit(opened === 1 && String(hit).includes('t3-icon-button') ? 0 : 1);
