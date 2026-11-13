window.__ModuleLoader__.load({
  id: '@local/dsh-t3-session-sidebar',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 't3-session-sidebar';
    // Settled sessions are the backlog: start that group collapsed so the
    // actionable groups stay visible. Any group can still be toggled by hand.
    const DEFAULT_COLLAPSED = Object.freeze({ settled: true });
    const dictionaries = {
      en: {
        enable: 'Use T3 sidebar', native: 'Use native sidebar', nativeShort: 'Use native', t3Short: 'Use T3', search: 'Search session titles',
        pinned: 'Pinned', active: 'Active', working: 'Working', settled: 'Settled',
        pin: 'Pin', unpin: 'Unpin', settle: 'Settle', unsettle: 'Unsettle', untitled: 'Untitled session',
        empty: 'No sessions', loading: 'Loading sessions…', syncing: 'Session placement unavailable. Retrying…',
        actionFailed: 'Action failed. Check the current state and retry.', openFailed: 'Could not open session.',
        expand: 'Open sidebar',
        menuDone: 'Session marked as settled.', menuRestored: 'Session reactivated.', more: 'Session actions',
        timeNow: 'now', timeMinutes: '{n}min', timeHours: '{n}h', timeDays: '{n}d', timeMonths: '{n}mo', timeYears: '{n}y',
        statusOngoing: 'Working', statusWarning: 'Waiting for you', statusDone: 'Finished'
      },
      ['z' + 'h']: {
        enable: '切换至 T3 侧栏', native: '切换至原生侧栏', nativeShort: '切换至原生', t3Short: '切换至 T3', search: '搜索会话标题',
        pinned: '已置顶', active: '活跃', working: '工作中', settled: '已完成',
        pin: '置顶', unpin: '取消置顶', settle: '完成', unsettle: '重新激活', untitled: '未命名会话',
        empty: '暂无会话', loading: '正在加载会话…', syncing: '无法同步会话状态，正在重试…',
        actionFailed: '操作失败，请检查当前状态后重试。', openFailed: '无法打开会话。',
        expand: '展开侧边栏',
        menuDone: '会话已标记为完成。', menuRestored: '会话已重新激活。', more: '会话操作',
        timeNow: '刚刚', timeMinutes: '{n}分钟', timeHours: '{n}小时', timeDays: '{n}天', timeMonths: '{n}个月', timeYears: '{n}年',
        statusOngoing: '工作中', statusWarning: '等待你操作', statusDone: '已完成'
      }
    };
    const css = `
      .t3-sidebar{display:flex;flex-direction:column;min-height:0;flex:1;color:var(--dsw-alias-label-primary);font-size:13px}
      .t3-bar{display:flex;gap:6px;align-items:center;padding:8px 10px}
      .t3-search{min-width:0;flex:1;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:6px 8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit}
      .t3-btn{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:5px;padding:5px}
      .t3-btn:hover,.t3-btn:focus-visible{background:var(--dsw-alias-bg-layer-2)}
      .t3-btn:disabled{opacity:.45;cursor:default}
      .t3-scroll{display:flex;flex-direction:column;flex:1 1 auto;overflow:auto;min-height:0;padding:0 6px 10px}
      .t3-group{flex:none;margin-top:7px}
      /* T3 hangs the Working and Settled shelves off the foot of the list: the
         first shelf header takes the free space above it, so the gap opens under
         the actionable rows rather than under the backlog. With nothing left
         over, the auto margin collapses and the list simply scrolls. */
      .t3-group[data-shelf=true]{margin-top:auto}
      .t3-heading{display:flex;width:100%;align-items:center;gap:6px;text-align:left;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
      .t3-count{margin-left:auto;font-weight:400;color:var(--dsw-alias-label-caption)}
      .t3-message{padding:8px 12px;color:var(--dsw-alias-label-secondary);font-size:12px}
      .t3-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      /* T3 Code thread row: one rounded surface per session, two lines while it is
         live (workspace label + age over the title) and one muted line once it is
         settled. The trailing age swaps to the row actions on hover. */
      .t3-row{position:relative;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;min-width:0;margin:2px 0;padding:6px 8px;border-radius:8px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);outline:none}
      .t3-row:hover,.t3-row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}
      .t3-row[data-current=true]{background:var(--dsw-alias-interactive-bg-active)}
      /* A live run is named by its accent label alone. Background stays reserved
         for hover, keyboard focus and the current session, so a running row that
         is neither stays flat like every other unselected row. */
      .t3-top{display:flex;align-items:center;gap:6px;min-width:0;height:16px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .t3-pin{display:inline-flex;flex:none;color:var(--dsw-alias-label-caption)}
      .t3-proj{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .t3-line{display:flex;align-items:center;gap:6px;min-width:0}
      .t3-open{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:18px;cursor:pointer}
      .t3-row[data-variant=card] .t3-open{font-weight:500}
      .t3-row[data-variant=slim] .t3-open{color:var(--dsw-alias-label-tertiary)}
      .t3-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
      .t3-status{display:inline-flex;flex:none;align-items:center}
      .t3-dot{position:relative;width:10px;height:10px}
      .t3-dot::after{content:'';position:absolute;inset:20%;border-radius:50%}
      .t3-dot[data-state=done]::after{background:var(--dsw-alias-state-success-primary)}
      .t3-dot[data-state=warning]::after{background:var(--dsw-alias-state-warn-primary)}
      .t3-spinner{width:12px;height:12px;color:var(--dsw-alias-label-tertiary);animation:t3-spin 1.5s linear infinite}
      .t3-live .t3-spinner{color:currentColor}
      .t3-spinner circle{fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
      .t3-spinner .t3-track{opacity:.25}
      .t3-spinner .t3-arc{stroke-dasharray:20 150}
      @keyframes t3-spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion: reduce){.t3-spinner{animation:none}}
      .t3-slot{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:flex-end;min-width:26px;height:18px;margin-left:auto}
      .t3-time{font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;transition:opacity .12s ease;pointer-events:none}
      /* T3 names the live run instead of the age: spinner + Working + elapsed,
         in the accent colour, in the same slot the age vacates on hover. */
      .t3-live{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-state-business-primary);font-weight:500}
      .t3-actions{position:absolute;right:0;top:0;display:inline-flex;align-items:center;gap:2px;opacity:0;pointer-events:none;transition:opacity .12s ease}
      /* 18px tall so the hover action strip never grows the slot it replaces. */
      .t3-icon-button{display:inline-flex;align-items:center;justify-content:center;width:20px;height:18px;padding:0;border:0;background:transparent;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
      .t3-icon-button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
      .t3-icon-button:disabled{opacity:.45;cursor:default}
      .t3-icon-button[data-pinned=true]{color:var(--dsw-alias-brand-primary)}
      /* Fine-pointer hover only, like T3's group-any-hover: a touch tap latches
         :hover and would pin the action strip over the age label. */
      @media (hover:hover) and (pointer:fine){
        .t3-row:hover .t3-pin{display:none}
        .t3-row[data-variant=slim]:hover .t3-open{color:var(--dsw-alias-label-primary)}
      }
      .t3-row:hover .t3-time,.t3-row:focus-within .t3-time,.t3-row:has([aria-expanded=true]) .t3-time{position:absolute;right:0;opacity:0}
      .t3-row:hover .t3-actions,.t3-row:focus-within .t3-actions,.t3-row:has([aria-expanded=true]) .t3-actions{position:static;opacity:1;pointer-events:auto}
      .t3-row:hover .t3-pin,.t3-row:focus-within .t3-pin,.t3-row:has([aria-expanded=true]) .t3-pin{display:none}
      .t3-footer{display:inline-flex;align-items:center;gap:8px;flex:1 1 0;width:100%;min-width:0;height:32px;padding:0 10px;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;white-space:nowrap}
      .t3-footer svg{flex:none}
      .t3-footer[data-wide=false]{flex:none;width:32px;justify-content:center;padding:0}
      .t3-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    `;
    function PinIcon({ filled = false, size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M16 4v5l3 3v2H5v-2l3-3V4', fill: filled ? 'currentColor' : 'none' }),
        h('path', { d: 'M6 4h12M12 14v7' }));
    }
    function SwitchSidebarIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M9 4v16' }));
    }
    function SettledIcon({ restored = false }) {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: restored ? 'M4 10a8 8 0 1 1 2.4 6.7M4 5v5h5' : 'M5 12l4.3 4.3L19 6.6' }));
    }
    function StatusGlyph({ state }) {
      if (state === 'ongoing') return h('svg', { className: 't3-spinner', viewBox: '0 0 24 24', 'aria-hidden': true },
        h('circle', { className: 't3-track', cx: 12, cy: 12, r: 9.5 }),
        h('circle', { className: 't3-arc', cx: 12, cy: 12, r: 9.5 }));
      return h('span', { className: 't3-dot', 'data-state': state, 'aria-hidden': true });
    }
    // Same buckets as the native sidebar's relative time, so both surfaces name
    // one session's age identically; the words stay in this plugin's dictionary.
    const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
    function relativeUnit(at, now) {
      const diff = Math.max(0, now - at);
      if (!Number.isFinite(at) || diff < MINUTE) return ['now', 0];
      if (diff < HOUR) return ['minutes', Math.floor(diff / MINUTE)];
      if (diff < DAY) return ['hours', Math.floor(diff / HOUR)];
      if (diff < 30 * DAY) return ['days', Math.floor(diff / DAY)];
      if (diff < 365 * DAY) return ['months', Math.floor(diff / (30 * DAY))];
      return ['years', Math.floor(diff / (365 * DAY))];
    }
    function timeLabel(t, at, now) {
      const [unit, n] = relativeUnit(at, now);
      if (unit === 'now') return t('timeNow');
      return t('time' + unit[0].toUpperCase() + unit.slice(1)).replace('{n}', String(n));
    }
    /** Elapsed run time for the live label; the first minute shows the bare
       status so the row never reads "工作中 刚刚". */
    function workingDuration(t, since, now) {
      if (!Number.isFinite(since)) return null;
      const [unit, n] = relativeUnit(since, now);
      if (unit === 'now') return null;
      return t('time' + unit[0].toUpperCase() + unit.slice(1)).replace('{n}', String(n));
    }
    function pathLabel(value) {
      const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : '';
    }
    /** Minute-aligned clock, so only the age labels need a fresh render each minute. */
    function useNowMinute() {
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        let timer;
        const arm = () => { timer = setTimeout(() => { setNow(Date.now()); arm(); }, 60000 - (Date.now() % 60000)); };
        arm();
        return () => clearTimeout(timer);
      }, []);
      return now;
    }
    function unwrap(result) {
      if (!result || result.ok !== true) throw new Error(result?.error?.message || 'RPC failed');
      return result.value;
    }
    function validSnapshot(value) {
      return value && typeof value.epoch === 'string' && Number.isSafeInteger(value.revision) && value.revision >= 0 && value.placements && typeof value.placements === 'object' && !Array.isArray(value.placements);
    }
    function Sidebar({ wide, expandSidebar, useSessions, useSessionStatus, useWorkspaces, usePanelInfo, useContextMenu, renderFactorySlot, t }) {
      const { getTriggerProps } = useContextMenu();
      const panelActive = usePanelInfo(info => info.activePanelId !== null);
      const sessions = useSessions(s => s);
      const statuses = useSessionStatus(s => s);
      const workspaces = useWorkspaces(s => s);
      const nowMinute = useNowMinute();
      const [snapshot, setSnapshot] = React.useState(null);
      const [syncError, setSyncError] = React.useState(false);
      const [actionError, setActionError] = React.useState(false);
      const [uiError, setUiError] = React.useState('');
      const [query, setQuery] = React.useState('');
      const [collapsed, setCollapsed] = React.useState(() => ({ ...DEFAULT_COLLAPSED }));
      const [pending, setPending] = React.useState({});
      const [workingIds, setWorkingIds] = React.useState(() => new Set());
      const workingRef = React.useRef(new Map());
      React.useEffect(() => {
        const now = Date.now();
        const pinnedIds = new Set(workspaces?.pinnedSessionIds || []);
        const present = new Set(sessions?.ids || []);
        const next = new Set();
        let nextDeadline = Infinity;
        for (const id of present) {
          const status = statuses?.get(id);
          const running = status?.running ?? sessions.byId?.[id]?.running;
          const pendingInteraction = status?.pendingInteraction;
          const settled = !!snapshot?.placements?.[id]?.settled;
          const pinned = pinnedIds.has(id);
          const placement = `${pinned}:${settled}`;
          const previous = workingRef.current.get(id);
          const actual = !!running && !pendingInteraction;
          const canWait = !actual && previous?.working && !pendingInteraction && !pinned && !settled && previous.placement === placement;
          const deadline = canWait ? (previous.deadline ?? now + 2000) : null;
          const working = actual || (deadline !== null && deadline > now);
          // DSH publishes no run-start clock, so a run is anchored at the last
          // recorded activity the moment the sidebar first sees it running.
          const known = sessions.byId?.[id]?.updatedAt;
          const anchor = Number.isFinite(known) ? Math.min(known, now) : now;
          const since = working ? (previous?.working ? previous.since ?? anchor : anchor) : null;
          workingRef.current.set(id, { working, deadline: working ? deadline : null, placement, since });
          if (working) next.add(id);
          if (working && deadline !== null) nextDeadline = Math.min(nextDeadline, deadline);
        }
        for (const id of workingRef.current.keys()) if (!present.has(id)) workingRef.current.delete(id);
        setWorkingIds(next);
        if (nextDeadline === Infinity) return;
        let timer;
        const schedule = (deadline) => {
          timer = setTimeout(() => {
            const at = Date.now();
            let following = Infinity;
            for (const state of workingRef.current.values()) {
              if (state.deadline !== null && state.deadline <= at) {
                state.working = false;
                state.deadline = null;
                state.since = null;
              }
              if (state.deadline !== null) following = Math.min(following, state.deadline);
            }
            setWorkingIds(new Set([...workingRef.current].filter(([, state]) => state.working).map(([id]) => id)));
            if (following !== Infinity) schedule(following);
          }, Math.max(0, deadline - Date.now()));
        };
        schedule(nextDeadline);
        return () => clearTimeout(timer);
      }, [sessions, statuses, workspaces, snapshot]);
      const pollRef = React.useRef(null);
      const operations = React.useRef(new Set());
      const alive = React.useRef(false);
      const context = Sidebar.context;
      React.useEffect(() => {
        alive.current = true;
        let cursor = null;
        let stopped = false;
        let timer;
        let active;
        const run = async () => {
          active = new AbortController();
          pollRef.current = active;
          try {
            const value = unwrap(await context.connection.rpc.call('/api', 't3-session-sidebar/snapshot', cursor || {}, active.signal));
            if (!validSnapshot(value)) throw new Error('Invalid snapshot');
            if (stopped) return;
            cursor = { epoch: value.epoch, revision: value.revision };
            setSnapshot(value);
            setSyncError(false);
            timer = setTimeout(run, 250);
          } catch (error) {
            if (stopped) return;
            if (!active.signal.aborted) setSyncError(true);
            cursor = null;
            timer = setTimeout(run, active.signal.aborted ? 0 : 2000);
          }
        };
        run();
        return () => {
          stopped = true;
          alive.current = false;
          clearTimeout(timer);
          active?.abort();
          pollRef.current = null;
          for (const operation of operations.current) operation.abort();
          operations.current.clear();
        };
      }, [context]);
      const act = async (id, action) => {
        if (pending[id] || syncError || !snapshot) return;
        setActionError(false);
        const controller = new AbortController();
        operations.current.add(controller);
        setPending(value => ({ ...value, [id]: true }));
        try {
          unwrap(await context.connection.rpc.call('/api', 't3-session-sidebar/action', { action, sessionId: id }, controller.signal));
        } catch (error) {
          if (alive.current && !controller.signal.aborted) setActionError(true);
        } finally {
          operations.current.delete(controller);
          if (alive.current) {
            setPending(value => { const next = { ...value }; delete next[id]; return next; });
            // Both success and failure can have changed durable state.
            pollRef.current?.abort();
          }
        }
      };
      const runUi = (fn, errorKey) => {
        setUiError('');
        try { Promise.resolve(fn()).catch(() => { if (alive.current) setUiError(errorKey); }); }
        catch { setUiError(errorKey); }
      };
      // T3's row header names the project; DSH's equivalent is the Workspace
      // the session is accounted to, falling back to its directory name.
      const workspaceLabel = new Map();
      for (const workspace of workspaces?.items || []) {
        const label = workspace.title || pathLabel(workspace.path);
        if (!label) continue;
        for (const id of workspace.sessionIds || []) workspaceLabel.set(id, label);
      }
      const archived = new Set(workspaces?.archivedSessionIds || []);
      const pinned = new Set(workspaces?.pinnedSessionIds || []);
      const groups = { pinned: [], active: [], working: [], settled: [] };
      const needle = query.trim().toLocaleLowerCase();
      for (const id of sessions?.ids || []) {
        const session = sessions.byId?.[id];
        if (!session || archived.has(id) || session.origin === 'subagent' || (session.blank && !(session.retainedBy?.mainView > 0))) continue;
        const title = session.displayTitle || t('untitled');
        if (needle && !title.toLocaleLowerCase().includes(needle)) continue;
        const placement = snapshot?.placements?.[id];
        const status = statuses?.get(id);
        // The native sidebar can pin a settled session without clearing our
        // record. Keep that pin visible until the user resolves both flags.
        const group = pinned.has(id) ? 'pinned' : placement?.settled ? 'settled' : !status?.pendingInteraction && workingIds.has(id) ? 'working' : 'active';
        groups[group].push({ id, title, session, placement });
      }
      const pins = workspaces?.pinnedSessionIds || [];
      groups.pinned.sort((a, b) => pins.indexOf(a.id) - pins.indexOf(b.id));
      const activity = row => Math.max(row.session.updatedAt || 0, row.placement?.unsettledAt || 0);
      groups.active.sort((a, b) => activity(b) - activity(a));
      groups.working.sort((a, b) => activity(b) - activity(a));
      groups.settled.sort((a, b) => (b.placement?.settledAt || 0) - (a.placement?.settledAt || 0));
      const shown = ['pinned', 'active', 'working', 'settled'].filter(group => group !== 'pinned' || groups.pinned.length > 0);
      const shelf = shown.find(group => group === 'working' || group === 'settled');
      if (!wide) return h('div', { className: 't3-sidebar' }, h('style', null, css), h('button', { className: 't3-btn', type: 'button', title: t('expand'), 'aria-label': t('expand'), onClick: expandSidebar }, '☰'));
      return h('div', { className: 't3-sidebar' }, h('style', null, css),
        h('div', { className: 't3-bar' },
          h('input', { className: 't3-search', type: 'search', value: query, placeholder: t('search'), 'aria-label': t('search'), onChange: event => setQuery(event.target.value) })),
        (syncError || actionError) && h('div', { className: 't3-message', role: 'status' }, t(actionError ? 'actionFailed' : 'syncing')),
        uiError && h('div', { className: 't3-message', role: 'alert' }, t(uiError)),
        !snapshot ? h('div', { className: 't3-message', role: 'status' }, t(syncError ? 'syncing' : 'loading')) :
        h('div', { className: 't3-scroll' }, shown.map(group => h('section', { className: 't3-group', key: group, 'data-shelf': group === shelf },
          h('button', { className: 't3-btn t3-heading', type: 'button', 'aria-expanded': !collapsed[group], onClick: () => setCollapsed(value => ({ ...value, [group]: !value[group] })) },
            h('span', { 'aria-hidden': true }, collapsed[group] ? '▸' : '▾'), t(group), h('span', { className: 't3-count' }, String(groups[group].length))),
          !collapsed[group] && groups[group].map(({ id, title, session, placement }) => {
            const isPinned = pinned.has(id);
            const isSettled = !!placement?.settled;
            const pinAction = isPinned ? 'unpin' : 'pin';
            const settleAction = isSettled ? 'unsettle' : 'settle';
            const target = { kind: 'session', value: { sessionId: id, displayTitle: session.displayTitle || '' } };
            const trigger = getTriggerProps(session.blank ? undefined : target, {
              tabIndex: -1,
              onKeyDown: event => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                runUi(() => context.uiWorkspace.openSession(id), 'openFailed');
              },
            });
            const status = statuses?.get(id);
            const state = status?.pendingInteraction ? 'warning'
              : workingIds.has(id) || status?.running ? 'ongoing'
              : status?.completionUnread ? 'done' : null;
            const stateLabel = state && t('status' + state[0].toUpperCase() + state.slice(1));
            const live = state === 'ongoing';
            const duration = live ? workingDuration(t, workingRef.current.get(id)?.since, nowMinute) : null;
            const busy = !!pending[id] || syncError;
            // One trailing cell carries the age — or, while the agent runs, the
            // live status and its elapsed time — and on hover the row verbs.
            // Clicks on the strip stay there instead of opening the session.
            const slot = session.blank ? null : h('span', { className: 't3-slot' },
              live
                ? h('span', { className: 't3-time t3-live', title: stateLabel },
                  h(StatusGlyph, { state: 'ongoing' }),
                  h('span', null, stateLabel),
                  duration && h('span', { className: 't3-duration' }, duration))
                : h('span', { className: 't3-time', 'aria-hidden': true }, timeLabel(t, session.updatedAt, nowMinute)),
              // The menu trigger trails the row verbs, so it sits on the row's
              // right edge where the pointer already rests.
              h('span', { className: 't3-actions', onClick: event => event.stopPropagation() },
                h('button', { className: 't3-icon-button', 'data-pinned': isPinned, type: 'button', disabled: busy, title: t(pinAction), 'aria-label': `${t(pinAction)}: ${title}`, onClick: () => act(id, pinAction) }, h(PinIcon, { filled: isPinned, size: 14 })),
                h('button', { className: 't3-icon-button', type: 'button', disabled: busy, title: t(settleAction), 'aria-label': `${t(settleAction)}: ${title}`, onClick: () => act(id, settleAction) }, h(SettledIcon, { restored: isSettled })),
                renderFactorySlot('contextMenu.button', { target, label: `${t('more')}: ${title}`, className: 't3-icon-button' })));
            const titleLine = h('div', { className: 't3-line' },
              h('button', { className: 't3-open', type: 'button', title }, title),
              state && (isSettled || !live) && h('span', { className: 't3-status', role: 'img', 'aria-label': stateLabel, title: stateLabel }, h(StatusGlyph, { state })),
              isSettled && slot);
            const topLine = isSettled ? null : h('div', { className: 't3-top' },
              isPinned && h('span', { className: 't3-pin', 'aria-hidden': true }, h(PinIcon, { filled: true, size: 12 })),
              h('span', { className: 't3-proj' }, workspaceLabel.get(id) || pathLabel(session.cwd)),
              slot);
            // The whole surface opens the session, as in T3; the title button only
            // carries the accessible name and keyboard focus.
            return h('div', {
              className: 't3-row', key: id, ...trigger,
              'data-variant': isSettled ? 'slim' : 'card',
              'data-working': live,
              'data-current': !panelActive && (session.retainedBy?.mainView || 0) > 0,
              onClick: () => runUi(() => context.uiWorkspace.openSession(id), 'openFailed'),
            }, topLine, titleLine);
          })))));
    }
    return {
      inject: ['slots', 'locale', 'connection', 'uiWorkspace', 'contextMenus', 'workspaces'],
      apply(ctx) {
        Sidebar.context = ctx;
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 't3-session-sidebar: dictionaries');
        ctx.slots.inject('contextMenu.icon', function* () {
          yield ctx.slots.register({ name: 'contextMenu.icon', key: NS + '.settle' }, SettledIcon);
          yield ctx.slots.register({ name: 'contextMenu.icon', key: NS + '.unsettle' }, () => h(SettledIcon, { restored: true }));
        });
        ctx.effect(() => ctx.contextMenus.register({
          id: 't3-sidebar.settled', target: 'session', order: 150,
          observe: () => [ctx.locale, ctx.workspaces.list],
          async resolve(target, signal) {
            const workspaceList = ctx.get('workspaces')?.list?.getSnapshot();
            if (!workspaceList || workspaceList.archivedSessionIds.includes(target.sessionId)) return [];
            // A failed or slow sidecar must not prevent the built-in menu from
            // opening. The menu simply omits this contribution until it recovers.
            const abort = new AbortController();
            const cancel = () => abort.abort();
            if (signal.aborted) return [];
            signal.addEventListener('abort', cancel, { once: true });
            const timer = setTimeout(cancel, 350);
            let snapshot;
            try {
              snapshot = unwrap(await ctx.connection.rpc.call('/api', 't3-session-sidebar/snapshot', {}, abort.signal));
              if (!validSnapshot(snapshot)) return [];
            } catch { return []; }
            finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
            const settled = !!snapshot.placements[target.sessionId]?.settled;
            const action = settled ? 'unsettle' : 'settle';
            const t = ctx.locale.bind(NS);
            return [{
              id: 'settled', label: t(action), icon: { key: NS + '.' + action },
              failureLabel: t('actionFailed'),
              async run() {
                // The menu's preparation signal ends on dismissal; an action
                // owns its own request after selection.
                if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(target.sessionId)) throw new Error('Session is archived');
                const current = unwrap(await ctx.connection.rpc.call('/api', 't3-session-sidebar/snapshot', {}));
                if (!validSnapshot(current)) throw new Error('Invalid session placement');
                if (!!current.placements[target.sessionId]?.settled !== settled) throw new Error('Session placement changed');
                unwrap(await ctx.connection.rpc.call('/api', 't3-session-sidebar/action', { sessionId: target.sessionId, action }));
                ctx.contextMenus.notify(t(settled ? 'menuRestored' : 'menuDone'), true);
              },
            }];
          },
        }), 't3-session-sidebar: session menu');
        ctx.effect(() => {
          let enabled = true;
          let disposeSidebar;
          const listeners = new Set();
          const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
          const install = () => ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces', priority: -1000, locale: NS }, Sidebar));
          const toggle = () => {
            enabled = !enabled;
            if (enabled) disposeSidebar = install();
            else { disposeSidebar?.(); disposeSidebar = undefined; }
            listeners.forEach(listener => listener());
          };
          function Footer({ t, wide }) {
            const active = React.useSyncExternalStore(subscribe, () => enabled, () => enabled);
            const label = t(active ? 'native' : 'enable');
            return h(React.Fragment, null, h('style', null, css), h('button', { type: 'button', className: 't3-btn t3-footer', 'data-wide': wide, onClick: toggle, title: label, 'aria-label': label }, h(SwitchSidebarIcon), wide && h('span', { className: 't3-footer-label' }, t(active ? 'nativeShort' : 't3Short'))));
          }
          disposeSidebar = install();
          const disposeFooter = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 't3-session-sidebar-toggle-v8', order: 1000, locale: NS }, Footer));
          return () => { disposeSidebar?.(); disposeFooter?.(); listeners.clear(); };
        }, 't3-session-sidebar: slots');
      }
    };
  }
});
