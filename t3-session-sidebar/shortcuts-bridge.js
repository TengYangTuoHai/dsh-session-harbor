// registry.dispatch/invoke and fixedInput are private Client implementation
// methods. Check the method and descriptor boundaries before wrapping them.
const BLOCKED = Symbol('loading device');
const LOADING = 'Device conversation is loading';
const SHELL_COMMANDS = new Set(['sidebar.left.toggle', 'shortcuts.open']);
const owners = new WeakMap();

function unsupported(message, cause) {
  return Object.assign(new Error(`DSH shortcut routing is unsupported: ${message}`, { cause }), {
    code: 't3-shortcuts/unsupported',
  });
}
function object(value) { return value !== null && (typeof value === 'object' || typeof value === 'function'); }
function method(owner, key, label) {
  if (!object(owner)) throw unsupported(`${label} is unavailable`);
  let cursor = owner;
  let descriptor;
  while (cursor && !(descriptor = Object.getOwnPropertyDescriptor(cursor, key))) cursor = Object.getPrototypeOf(cursor);
  if (!descriptor || !('value' in descriptor) || typeof descriptor.value !== 'function') {
    throw unsupported(`${label} must be a data method`);
  }
  return { owner, key, value: descriptor.value, inherited: descriptor, own: Object.getOwnPropertyDescriptor(owner, key) };
}
function service(value, label) {
  if (!object(value)) throw unsupported(`${label}.registry is unavailable`);
  const registry = value.registry;
  if (!object(registry)) throw unsupported(`${label}.registry is unavailable`);
  return {
    identity: registry,
    dispatch: method(registry, 'dispatch', `${label}.registry.dispatch`),
    invoke: method(registry, 'invoke', `${label}.registry.invoke`),
    fixed: method(value, 'fixedInput', `${label}.fixedInput`),
  };
}
function checkPatch(record) {
  if (record.own ? !record.own.configurable && !record.own.writable : !Object.isExtensible(record.owner)) {
    throw unsupported(`${record.key} cannot be wrapped reversibly`);
  }
}
function restore(record) {
  // Reading a service method normally can produce a fresh Cordis shadow Proxy.
  // Its own descriptor retains the actual function installed by this adapter.
  if (Object.getOwnPropertyDescriptor(record.owner, record.key)?.value !== record.wrapper) return;
  if (record.own) Object.defineProperty(record.owner, record.key, record.own);
  else if (!Reflect.deleteProperty(record.owner, record.key)) throw unsupported(`${record.key} could not be restored`);
}
function call(record, args, receiver = record.owner) { return Reflect.apply(record.value, receiver, args); }
function reset(record) { if (record && record !== BLOCKED) call(record.fixed, [{ type: 'reset' }]); }
function boundCommands(shortcuts, gesture) {
  if (typeof shortcuts.catalog?.getSnapshot !== 'function') return null;
  const catalog = shortcuts.catalog.getSnapshot();
  if (!Array.isArray(catalog)) throw unsupported('the public shortcut catalog is unavailable');
  const modifiers = ['control', 'alt', 'shift', 'meta'];
  const matches = binding => binding && Array.isArray(binding.modifiers)
    && binding.modifiers.every(modifier => modifiers.includes(modifier))
    && modifiers.every(modifier => binding.modifiers.includes(modifier) === !!gesture[modifier]);
  const pair = gesture.secondCode === undefined ? [] : catalog.filter(({ binding }) => matches(binding)
    && ((binding.code === gesture.code && binding.secondCode === gesture.secondCode)
      || (binding.code === gesture.secondCode && binding.secondCode === gesture.code)));
  return pair.length ? pair : catalog.filter(({ binding }) => matches(binding)
    && binding.code === gesture.code && binding.secondCode === undefined);
}

function ownsInput(record, context, menu = false) {
  if (!record.ownsElement) return true;
  const element = context?.target;
  return record.ownsElement(element) || (menu && context?.modal == null && (!element || element.tagName === 'BODY'));
}

/** Route the single Host input owner to one active device, without local fallback. */
export function createShortcutRouter({ shortcuts, getTarget } = {}) {
  if (typeof getTarget !== 'function') throw unsupported('getTarget must be synchronous');
  const host = service(shortcuts, 'host shortcuts');
  if (owners.has(host.identity)) throw unsupported('the Host already has an active shortcut router');
  const owner = {};
  const patches = [host.dispatch, host.invoke, host.fixed];
  for (const record of patches) checkPatch(record);
  let disposed = false;
  let previous = host;

  function target(consume) {
    try {
      const value = getTarget();
      let next;
      if (value === null) next = host;
      else if (object(value) && value.blocked === true) next = BLOCKED;
      else {
        next = service(value?.shortcuts ?? value, 'device shortcuts');
        next.ownsElement = value?.ownsElement;
        if (next.identity === host.identity || next.fixed.value === host.fixed.wrapper) {
          throw unsupported('device shortcuts must have an independent registry and input owner');
        }
      }
      const before = previous === BLOCKED ? BLOCKED : previous.identity;
      const after = next === BLOCKED ? BLOCKED : next.identity;
      if (before !== after) {
        // Invalidate an armed sequence when its input owner changes. A reset is
        // the native fixed-input contract's non-writing cancellation event.
        reset(previous);
        reset(next);
      }
      previous = next;
      return next;
    } catch (error) {
      consume?.();
      throw error;
    }
  }

  host.dispatch.wrapper = function (...args) {
    if (disposed) return call(host.dispatch, args, this);
    const [gesture, context, consume] = args;
    const next = target(consume);
    if (next === host) return call(host.dispatch, args, this);
    if (!gesture || gesture.composing || gesture.defaultPrevented) return { status: 'pass' };
    const commands = next === BLOCKED || next.ownsElement ? boundCommands(shortcuts, gesture) : null;
    if (commands?.length === 1 && SHELL_COMMANDS.has(commands[0].id)) return call(host.dispatch, args, this);
    if (next === BLOCKED) {
      const managed = commands === null ? gesture.control || gesture.meta || gesture.alt
        || [gesture.code, gesture.secondCode].some(code => /^F(?:[1-9]|1[0-9]|2[0-4])$/.test(code)) : commands.length > 0;
      if (!managed) return { status: 'pass' };
      consume?.();
      const commandId = commands?.[0]?.id;
      return { status: 'blocked', ...(commandId === undefined ? {} : { commandId }), reason: LOADING };
    }
    if (!ownsInput(next, context)) return { status: 'pass' };
    return call(next.dispatch, args);
  };
  host.invoke.wrapper = function (...args) {
    if (disposed) return call(host.invoke, args, this);
    const next = target();
    if (next === host || SHELL_COMMANDS.has(args[0])) return call(host.invoke, args, this);
    if (next !== BLOCKED && ownsInput(next, args[1], true)) return call(next.invoke, args);
  };
  host.fixed.wrapper = function (...args) {
    if (disposed) return call(host.fixed, args, this);
    const input = args[0];
    const consume = input?.type === 'keydown' && typeof input.consume === 'function' ? () => input.consume() : undefined;
    const next = target(consume);
    if (next === host) return call(host.fixed, args, this);
    if (next === BLOCKED) return;
    if (input?.type === 'keydown' && !ownsInput(next, input.context)) return reset(next);
    if (next.ownsElement && input?.type === 'keydown' && shortcuts.fixedCatalog?.getSnapshot().some(row => row.id.startsWith('fontSize.')
      && row.bindings.some(binding => binding.code === input.gesture.code
        && ['control', 'alt', 'shift', 'meta'].every(modifier => binding.modifiers.includes(modifier) === !!input.gesture[modifier])))) return;
    return call(next.fixed, args);
  };

  const applied = [];
  owners.set(host.identity, owner);
  try {
    for (const record of patches) {
      Object.defineProperty(record.owner, record.key, record.own
        ? { ...record.own, value: record.wrapper }
        : { value: record.wrapper, configurable: true, writable: true, enumerable: record.inherited.enumerable });
      applied.push(record);
    }
  } catch (cause) {
    disposed = true;
    if (owners.get(host.identity) === owner) owners.delete(host.identity);
    const failures = [];
    for (const record of applied.reverse()) { try { restore(record); } catch (error) { failures.push(error); } }
    throw unsupported('the routing methods could not be installed atomically', failures.length ? new AggregateError([cause, ...failures]) : cause);
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (owners.get(host.identity) === owner) owners.delete(host.identity);
      const failures = [];
      for (const record of [...patches].reverse()) { try { restore(record); } catch (error) { failures.push(error); } }
      try { if (previous !== host) reset(previous); } catch (error) { failures.push(error); }
      previous = host;
      if (failures.length) throw unsupported('the routing methods could not be fully restored', new AggregateError(failures));
    },
  };
}
