import { randomUUID } from 'node:crypto';
import { readSshConfig } from './ssh-config.js';
import { ConnectionManager, validateConnectOptions } from './connection-manager.js';
import { AutoConnect } from './auto-connect.js';

const MAX_TARGETS = 200;
const MAX_LABEL = 120;

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value;
}

function identifier(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(value)) throw new Error('Invalid target or connection ID');
  return value;
}

export function normalizeTarget(value) {
  object(value, 'Target');
  const options = validateConnectOptions(value);
  const label = value.label === undefined || value.label === '' ? options.host : value.label;
  if (typeof label !== 'string' || label.length > MAX_LABEL || /[\x00-\x1f\x7f]/u.test(label)) {
    throw new Error('Connection name must be at most 120 characters without control characters');
  }
  return { id: value.id === undefined ? randomUUID() : identifier(value.id), label: label.trim() || options.host, ...options };
}

/** Saved device settings and connection lifecycle. Only connection options are persisted. */
export class SshService {
  constructor({ targets, manager, configPath, readConfig = readSshConfig, ...managerOptions }) {
    this.table = targets;
    this.manager = manager ?? new ConnectionManager({ ...managerOptions, ...(configPath ? { configPath } : {}) });
    this.configPath = configPath;
    this.readConfig = readConfig;
    this.targets = new Map();
    this.config = { path: configPath ?? '~/.ssh/config', hosts: [], warnings: [] };
    this.writeQueue = Promise.resolve();
    this.disposed = false;
    this.autoConnect = undefined;
    this.autoConnectFollow = undefined;
  }

  async initialize() {
    for (const [id, value] of this.table.entries()) {
      const target = normalizeTarget({ ...object(value, 'Saved target'), id });
      this.targets.set(id, target);
    }
    await this.refresh();
    return this;
  }

  snapshot() {
    return {
      config: structuredClone(this.config),
      targets: [...this.targets.values()].map(value => ({ ...value })),
      connections: this.manager.list(),
      ...(this.autoConnect ? { autoConnect: this.autoConnect.status() } : {}),
    };
  }

  async refresh() {
    this.config = await this.readConfig(this.configPath ? { configPath: this.configPath } : {});
    return this.snapshot();
  }

  serialize(operation) {
    const pending = this.writeQueue.then(() => {
      if (this.disposed) throw new Error('SSH plugin has stopped');
      return operation();
    });
    this.writeQueue = pending.catch(() => {});
    return pending;
  }

  async execute(request) {
    if (this.disposed) throw new Error('SSH plugin has stopped');
    object(request, 'Request');
    switch (request.action) {
      case 'list': return this.snapshot();
      case 'refresh': return this.refresh();
      case 'save': return this.serialize(async () => {
        const target = normalizeTarget(request.target);
        const matchingId = this.targetIdForConnection(target);
        if (matchingId && matchingId !== target.id) return { target: { ...this.targets.get(matchingId) } };
        if (this.targets.has(target.id) && matchingId !== target.id) throw new Error('Remove the saved SSH target before changing its connection options');
        if (!this.targets.has(target.id) && this.targets.size >= MAX_TARGETS) throw new Error('At most 200 saved SSH connections are supported');
        await this.table.put(target.id, target);
        this.targets.set(target.id, target);
        return { target: { ...target } };
      });
      case 'remove': return this.serialize(async () => {
        const id = identifier(request.id);
        if (!this.targets.has(id)) return { removed: false };
        await this.table.delete(id);
        this.autoConnect?.suppress(id);
        const live = this.connectionFor(id);
        const stopping = live && this.manager.disconnect(live.id);
        this.targets.delete(id);
        await stopping;
        return { removed: true };
      });
      case 'connect': return this.connectTarget(request.id);
      case 'disconnect': return this.serialize(async () => {
        const id = identifier(request.id);
        const state = this.manager.get(id);
        if (!state) throw new Error('SSH connection was not found');
        const targetId = this.targetIdForConnection(state);
        if (targetId) this.autoConnect?.suppress(targetId);
        await this.manager.disconnect(id);
        return { connection: this.manager.get(id) };
      });
      default: throw new Error('Unknown SSH action');
    }
  }


  /** Resolve a saved target to its live (connecting or connected) connection state. */
  connectionFor(targetId) {
    const target = this.targets.get(identifier(targetId));
    if (!target) return undefined;
    const options = validateConnectOptions(target);
    return this.manager.list().find(state => (state.status === 'connected' || state.status === 'connecting')
      && Object.entries(options).every(([key, value]) => state[key] === value));
  }

  /** Connections are keyed by their settings, so map a connection back to the saved target that owns it. */
  targetIdForConnection(state) {
    if (!state) return undefined;
    for (const target of this.targets.values()) {
      const options = validateConnectOptions(target);
      if (Object.entries(options).every(([key, value]) => state[key] === value)) return target.id;
    }
    return undefined;
  }

  /** Connect one saved target and report the outcome to the reconnect policy. */
  connectTarget(targetId, autoConnect) {
    return this.serialize(() => {
      if (autoConnect && this.autoConnect !== autoConnect) return {};
      const target = this.targets.get(identifier(targetId));
      if (!target) throw new Error('Saved SSH target was not found');
      const connection = this.manager.connect(validateConnectOptions(target));
      if (!autoConnect) this.autoConnect?.noteTarget(target.id);
      return { connection };
    });
  }

  /**
   * Keep every saved target reachable. Opt-out is per target: a deliberate
   * disconnect is respected until the user connects that target again.
   */
  startAutoConnect(options = {}) {
    if (this.autoConnect) return this.autoConnect.status();
    const autoConnect = new AutoConnect({
      targets: () => [...this.targets.keys()],
      connect: async targetId => {
        const { connection } = await this.connectTarget(targetId, autoConnect);
        if (connection) await this.manager.waitConnected(connection.id);
      },
      isActive: targetId => Boolean(this.connectionFor(targetId)),
      ...(options.logger === undefined ? {} : { logger: options.logger }),
      ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
      ...(options.staggerMs === undefined ? {} : { staggerMs: options.staggerMs }),
      ...(options.backoffMs === undefined ? {} : { backoffMs: options.backoffMs }),
    });
    this.autoConnect = autoConnect;
    this.autoConnectFollow = this.manager.onChange(state => {
      const targetId = this.targetIdForConnection(state);
      if (!targetId || !this.autoConnect) return;
      if (state.status === 'connected') this.autoConnect.noteSuccess(targetId);
      else if (state.status === 'error') this.autoConnect.noteFailure(targetId);
    });
    return this.autoConnect.start().status();
  }

  stopAutoConnect() {
    this.autoConnectFollow?.();
    this.autoConnectFollow = undefined;
    this.autoConnect?.stop();
    this.autoConnect = undefined;
  }

  async dispose() {
    this.stopAutoConnect();
    this.disposed = true;
    await this.writeQueue;
    await this.manager.dispose();
  }
}
