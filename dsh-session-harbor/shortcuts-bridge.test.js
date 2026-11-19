import test from 'node:test';
import assert from 'node:assert/strict';
import { createShortcutRouter } from './shortcuts-bridge.js';

const unsupported = { code: 't3-shortcuts/unsupported' };
class Registry {
  constructor(label) { this.label = label; this.calls = []; this.runs = 0; this.pass = false; }
  dispatch(gesture, context, consume) {
    assert.equal(this.label, context.owner);
    this.calls.push(['dispatch', gesture.code, context]);
    if (this.pass) return { status: 'pass' };
    consume();
    this.runs++;
    return { status: 'handled', commandId: 'same.command' };
  }
  invoke(id, context) {
    assert.equal(this.label, context.owner);
    this.calls.push(['invoke', id, context]);
    this.runs++;
  }
}
class Shortcuts {
  constructor(label) { this.label = label; this.registry = new Registry(label); this.inputs = []; this.armed = false; this.stops = 0; }
  fixedInput(input) {
    this.inputs.push(input.type);
    if (input.type === 'reset') { this.armed = false; return; }
    assert.equal(this.label, input.context.owner);
    if (input.gesture.code !== 'Escape' || input.gesture.defaultPrevented) return;
    input.consume();
    if (this.armed) { this.stops++; this.armed = false; }
    else this.armed = true;
  }
}
const gesture = { code: 'KeyN', control: true, alt: false, shift: false, meta: false, repeat: false, composing: false, defaultPrevented: false };
function fixed(owner, consume = () => {}) { return { type: 'keydown', gesture: { ...gesture, code: 'Escape' }, context: { owner }, consume }; }
function fixture() {
  const host = new Shortcuts('host'), a = new Shortcuts('A'), b = new Shortcuts('B');
  let selected = null;
  const router = createShortcutRouter({ shortcuts: host, getTarget: () => selected });
  return { host, a, b, router, select(value) { selected = value; } };
}

test('same command ID routes DOM dispatch and native/menu invoke only to the active device', () => {
  const f = fixture();
  let consumed = 0;
  f.select(f.a);
  assert.deepEqual(f.host.registry.dispatch(gesture, { owner: 'A' }, () => consumed++), { status: 'handled', commandId: 'same.command' });
  f.host.registry.invoke('same.command', { owner: 'A' });
  f.select(f.b);
  f.host.registry.dispatch(gesture, { owner: 'B' }, () => consumed++);
  f.host.registry.invoke('same.command', { owner: 'B' });
  assert.equal(f.a.registry.runs, 2);
  assert.equal(f.b.registry.runs, 2);
  assert.equal(f.host.registry.runs, 0);
  assert.equal(consumed, 2);
  f.select(null);
  f.host.registry.invoke('same.command', { owner: 'host' });
  assert.equal(f.host.registry.runs, 1);
  f.router.dispose();
});

test('scoped commands reach device focus while workbench controls retain their local owner', () => {
  const f = fixture();
  const focusedDevice = {};
  const focusedSidebar = {};
  const local = { owner: 'host', target: focusedSidebar };
  const remote = { owner: 'A', target: focusedDevice };
  const shell = { ...gesture, code: 'KeyB' };
  let consumed = 0;
  f.host.catalog = { getSnapshot: () => [
    { id: 'sidebar.left.toggle', binding: { code: 'KeyB', modifiers: ['control'] } },
    { id: 'session.new', binding: { code: 'KeyN', modifiers: ['control'] } },
  ] };
  f.select({ shortcuts: f.a, ownsElement: element => element === focusedDevice });
  const consume = () => { consumed++; };
  assert.equal(f.host.registry.dispatch(gesture, local, consume).status, 'pass');
  f.host.registry.invoke('session.new', local);
  f.host.registry.dispatch(shell, local, consume);
  f.host.registry.invoke('sidebar.left.toggle', local);
  f.host.registry.dispatch(gesture, remote, consume);
  f.host.registry.invoke('session.new', remote);
  assert.equal(f.host.registry.runs, 2);
  assert.equal(f.a.registry.runs, 2);
  assert.equal(consumed, 2);
  f.router.dispose();
});

test('a device pass never falls back to the local registry', () => {
  const f = fixture();
  f.a.registry.pass = true;
  f.select(f.a);
  let consumed = 0;
  assert.deepEqual(f.host.registry.dispatch(gesture, { owner: 'A' }, () => consumed++), { status: 'pass' });
  assert.equal(consumed, 0);
  assert.equal(f.host.registry.calls.length, 0);
  f.router.dispose();
});

test('loading blocks managed dispatch and ignores menu and fixed input without consuming fixed keys', () => {
  const f = fixture();
  f.select({ blocked: true });
  let consumed = 0;
  assert.deepEqual(f.host.registry.dispatch(gesture, {}, () => consumed++), { status: 'blocked', reason: 'Device conversation is loading' });
  assert.equal(f.host.registry.invoke('same.command', {}), undefined);
  f.host.fixedInput(fixed('ignored', () => consumed++));
  f.host.fixedInput({ type: 'reset' });
  assert.equal(consumed, 1);
  assert.equal(f.host.registry.runs + f.a.registry.runs + f.b.registry.runs, 0);
  assert.equal(f.host.stops + f.a.stops + f.b.stops, 0);
  assert.equal(f.host.inputs.every(type => type === 'reset'), true);
  f.router.dispose();
});

test('loading preserves Tab, Shift+Tab, and plain text while catalog-free managed keys are consumed', () => {
  const f = fixture();
  f.select({ blocked: true });
  let consumed = 0;
  const plain = { ...gesture, control: false };
  for (const input of [
    { ...plain, code: 'Tab' }, { ...plain, code: 'Tab', shift: true },
    { ...plain, code: 'KeyA' }, { ...plain, code: 'KeyA', shift: true },
    { ...plain, code: 'Space' }, { ...plain, code: 'Escape' },
  ]) {
    assert.deepEqual(f.host.registry.dispatch(input, {}, () => consumed++), { status: 'pass' });
    f.host.fixedInput({ type: 'keydown', gesture: input, context: {}, consume: () => consumed++ });
  }
  assert.equal(consumed, 0);
  for (const input of [gesture, { ...plain, meta: true }, { ...plain, alt: true }, { ...plain, code: 'F12' }]) {
    assert.equal(f.host.registry.dispatch(input, {}, () => consumed++).status, 'blocked');
  }
  assert.equal(consumed, 4);
  assert.equal(f.host.registry.calls.length, 0);
  assert.equal(f.a.registry.calls.length + f.b.registry.calls.length, 0);
  assert.equal(f.host.inputs.every(type => type === 'reset'), true);
  f.router.dispose();
});

test('loading matches the current public catalog with exact modifiers and unordered chord keys', () => {
  const f = fixture();
  let rows = [
    { binding: { code: 'KeyN', modifiers: ['control'] } },
    { binding: { code: 'KeyJ', secondCode: 'KeyK', modifiers: ['alt', 'shift'] } },
    { binding: null },
  ];
  f.host.catalog = { getSnapshot() { assert.equal(this, f.host.catalog); return rows; } };
  f.select({ blocked: true });
  let consumed = 0;
  assert.equal(f.host.registry.dispatch(gesture, {}, () => consumed++).status, 'blocked');
  assert.equal(f.host.registry.dispatch({ ...gesture, code: 'KeyK', secondCode: 'KeyJ', control: false, alt: true, shift: true }, {}, () => consumed++).status, 'blocked');
  for (const input of [
    { ...gesture, code: 'Tab', control: false }, { ...gesture, code: 'Tab', control: false, shift: true },
    { ...gesture, code: 'KeyA', control: false }, { ...gesture, shift: true },
    { ...gesture, code: 'F12', control: false }, { ...gesture, code: 'KeyZ' },
    { ...gesture, code: 'KeyJ', control: false, alt: true, shift: true },
    { ...gesture, code: 'KeyJ', secondCode: 'KeyL', control: false, alt: true, shift: true },
    { ...gesture, composing: true }, { ...gesture, defaultPrevented: true },
  ]) assert.deepEqual(f.host.registry.dispatch(input, {}, () => consumed++), { status: 'pass' });
  assert.equal(consumed, 2);
  rows = [];
  assert.deepEqual(f.host.registry.dispatch(gesture, {}, () => consumed++), { status: 'pass' }, 'an available empty catalog must not use the fixture fallback');
  assert.equal(consumed, 2);
  assert.equal(f.host.registry.calls.length, 0);
  f.router.dispose();
});

test('fixed stop input and sequence reset stay with the active device', () => {
  const f = fixture();
  f.select(f.a);
  f.host.fixedInput(fixed('A'));
  f.select(f.b);
  f.host.fixedInput(fixed('B'));
  f.host.fixedInput(fixed('B'));
  assert.equal(f.b.stops, 1);
  assert.equal(f.a.stops, 0);
  f.select(f.a);
  f.host.fixedInput(fixed('A'));
  assert.equal(f.a.stops, 0, 'returning to A must not complete its earlier half sequence');
  f.host.fixedInput(fixed('A'));
  assert.equal(f.a.stops, 1);
  assert.equal(f.host.stops, 0);
  f.router.dispose();
});

test('null preserves local methods, return values, argument objects, and call receivers', () => {
  const registry = {
    dispatch(...args) { assert.equal(this, receiver); assert.deepEqual(args, dispatchArgs); return result; },
    invoke(...args) { assert.equal(this, receiver); assert.deepEqual(args, invokeArgs); return result; },
  };
  const host = { registry, fixedInput(...args) { assert.equal(this, receiver); assert.deepEqual(args, fixedArgs); return result; } };
  const receiver = { marker: 'original receiver' };
  const result = {};
  const dispatchArgs = [gesture, {}, () => {}], invokeArgs = ['same.command', {}], fixedArgs = [{ type: 'reset' }];
  const router = createShortcutRouter({ shortcuts: host, getTarget: () => null });
  assert.equal(registry.dispatch.apply(receiver, dispatchArgs), result);
  assert.equal(registry.invoke.apply(receiver, invokeArgs), result);
  assert.equal(host.fixedInput.apply(receiver, fixedArgs), result);
  router.dispose();
});

test('dispose deletes inherited-method overlays and restores exact own descriptors', () => {
  const host = new Shortcuts('host');
  const oldInvoke = host.registry.invoke;
  Object.defineProperty(host.registry, 'invoke', { value: oldInvoke, configurable: false, writable: true, enumerable: false });
  const ownInvoke = Object.getOwnPropertyDescriptor(host.registry, 'invoke');
  const oldFixed = host.fixedInput;
  Object.defineProperty(host, 'fixedInput', { value: oldFixed, configurable: true, writable: false, enumerable: true });
  const ownFixed = Object.getOwnPropertyDescriptor(host, 'fixedInput');
  const router = createShortcutRouter({ shortcuts: host, getTarget: () => null });
  assert.equal(Object.hasOwn(host.registry, 'dispatch'), true);
  router.dispose();
  router.dispose();
  assert.equal(Object.hasOwn(host.registry, 'dispatch'), false);
  assert.deepEqual(Object.getOwnPropertyDescriptor(host.registry, 'invoke'), ownInvoke);
  assert.deepEqual(Object.getOwnPropertyDescriptor(host, 'fixedInput'), ownFixed);
});

test('disposal uses descriptor identity despite service method-get proxies', () => {
  const raw = new Shortcuts('host');
  const host = new Proxy(raw, { get(target, key, receiver) {
    const value = Reflect.get(target, key, receiver);
    return typeof value === 'function' ? new Proxy(value, {}) : value;
  } });
  const router = createShortcutRouter({ shortcuts: host, getTarget: () => null });
  assert.notEqual(host.fixedInput, Object.getOwnPropertyDescriptor(host, 'fixedInput').value);
  router.dispose();
  assert.equal(Object.hasOwn(raw, 'fixedInput'), false);
  assert.equal(Object.hasOwn(raw.registry, 'dispatch'), false);
});

test('a later owner keeps its method and a retained disposed wrapper invokes only the original Host', () => {
  const f = fixture();
  f.select(f.a);
  const ours = f.host.registry.dispatch;
  let laterCalls = 0;
  const later = function (...args) { laterCalls++; return ours.apply(this, args); };
  f.host.registry.dispatch = later;
  f.router.dispose();
  assert.equal(f.host.registry.dispatch, later);
  f.host.registry.dispatch(gesture, { owner: 'host' }, () => {});
  assert.equal(laterCalls, 1);
  assert.equal(f.host.registry.runs, 1);
  assert.equal(f.a.registry.runs, 0);
});

test('unsupported or locked capability is rejected before any method is patched', () => {
  for (const configure of [
    host => { host.fixedInput = undefined; },
    host => { delete host.registry.invoke; host.registry.invoke = null; },
    host => Object.defineProperty(host, 'fixedInput', { value: host.fixedInput, configurable: false, writable: false }),
    host => Object.preventExtensions(host.registry),
    host => Object.defineProperty(host.registry, 'invoke', { get() { throw new Error('accessor must not execute'); }, configurable: true }),
  ]) {
    const host = new Shortcuts('host');
    configure(host);
    const before = [Object.getOwnPropertyDescriptors(host), Object.getOwnPropertyDescriptors(host.registry)];
    assert.throws(() => createShortcutRouter({ shortcuts: host, getTarget: () => null }), unsupported);
    assert.deepEqual(Object.getOwnPropertyDescriptors(host), before[0]);
    assert.deepEqual(Object.getOwnPropertyDescriptors(host.registry), before[1]);
  }
});

test('installation failure rolls back already installed methods', () => {
  const raw = new Shortcuts('host');
  const host = new Proxy(raw, { defineProperty(target, key, descriptor) {
    if (key === 'fixedInput') throw new Error('injected patch rejection');
    return Reflect.defineProperty(target, key, descriptor);
  } });
  assert.throws(() => createShortcutRouter({ shortcuts: host, getTarget: () => null }), unsupported);
  assert.equal(Object.hasOwn(raw.registry, 'dispatch'), false);
  assert.equal(Object.hasOwn(raw.registry, 'invoke'), false);
  assert.equal(Object.hasOwn(raw, 'fixedInput'), false);
  createShortcutRouter({ shortcuts: raw, getTarget: () => null }).dispose();
});

test('invalid, asynchronous, or Host-alias targets fail closed without a local fallback', () => {
  const f = fixture();
  for (const value of [undefined, {}, { registry: {} }, Promise.resolve(f.a), f.host]) {
    f.select(value);
    let consumed = 0;
    assert.throws(() => f.host.registry.dispatch(gesture, { owner: 'host' }, () => consumed++), unsupported);
    assert.equal(consumed, 1);
    assert.throws(() => f.host.registry.invoke('same.command', { owner: 'host' }), unsupported);
    assert.equal(f.host.registry.runs, 0);
  }
  f.router.dispose();
});

test('repeated installation is rejected and disposal permits a fresh owner', () => {
  const f = fixture();
  const wrapper = f.host.registry.dispatch;
  assert.throws(() => createShortcutRouter({ shortcuts: f.host, getTarget: () => null }), unsupported);
  assert.equal(f.host.registry.dispatch, wrapper);
  f.router.dispose();
  createShortcutRouter({ shortcuts: f.host, getTarget: () => null }).dispose();
});
