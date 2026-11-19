import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { TargetClient, RemoteFailure } from './remote-target-client.js';

const test = (name, run) => nodeTest(name, { timeout: 8000 }, run);

/** Wait for a wire effect that travels asynchronously after the client acted. */
async function until(predicate, message = 'the wire effect never arrived') {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
const GUID = '258EAFA5-E91C-47DA-95CA-C5AB0DC85B11';

/** Unmasked server -> client frame. */
function serverFrame(text) {
  const body = Buffer.from(text, 'utf8');
  const header = body.length < 126 ? Buffer.from([0x81, body.length]) : Buffer.concat([Buffer.from([0x81, 126]), Buffer.alloc(2)]);
  if (body.length >= 126) header.writeUInt16BE(body.length, 2);
  return Buffer.concat([header, body]);
}

/** Decode one masked client frame. */
function decodeFrame(buffer) {
  const opcode = buffer[0] & 0x0f;
  const short = buffer[1] & 0x7f;
  const offset = short < 126 ? 2 : 4;
  const mask = buffer.subarray(offset, offset + 4);
  const body = buffer.subarray(offset + 4);
  const payload = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) payload[index] = body[index] ^ mask[index & 3];
  return { opcode, json: opcode === 1 ? JSON.parse(payload.toString('utf8')) : undefined };
}

async function fixture(t) {
  const unary = [];
  const opened = [];
  const cancelled = [];
  const peers = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
      unary.push({ url: req.url, body });
      const respond = value => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'server-response', rpcId: body.rpcId, result: value }));
      };
      if (req.url === '/api/session/list') return respond({ ok: true, value: { items: [{ sessionId: 's-1', cwd: '/srv/app', updatedAt: 7 }] } });
      if (req.url === '/api/t3-session-sidebar/snapshot') return respond({ ok: true, value: { contract: 1, epoch: 'epoch-1', revision: 3, placements: { 's-1': { settled: true } } } });
      if (req.url === '/api/workspace/create') return respond({ ok: false, error: { code: 'workspace/invalid-path', message: 'That path is not usable.', details: {} } });
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    });
  });
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + GUID).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    socket.on('error', () => {});
    peers.push(socket);
    let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 2) {
        const short = pending[1] & 0x7f;
        const offset = short < 126 ? 2 : 4;
        const length = short < 126 ? short : pending.readUInt16BE(2);
        if (pending.length < offset + 4 + length) return;
        const frame = decodeFrame(pending.subarray(0, offset + 4 + length));
        pending = pending.subarray(offset + 4 + length);
        if (frame.json?.type === 'open') {
          opened.push(frame.json);
          if (frame.json.endpoint === 'workspace/follow') {
            socket.write(serverFrame(JSON.stringify({ type: 'item', streamId: frame.json.streamId, value: { items: [{ workspaceId: 'w-1', path: '/srv/app' }] } })));
            socket.write(serverFrame(JSON.stringify({ type: 'item', streamId: frame.json.streamId, value: { type: 'upsert', workspace: { workspaceId: 'w-2', path: '/srv/other' } } })));
            socket.write(serverFrame(JSON.stringify({ type: 'end', streamId: frame.json.streamId })));
          }
          if (frame.json.endpoint === 'session/control') {
            socket.write(serverFrame(JSON.stringify({ type: 'item', streamId: frame.json.streamId, value: { type: 'baseline', value: { projections: { 's-1': { asOfSeq: 2, values: { title: 'Deploy fix' } } } } } })));
          }
          if (frame.json.endpoint === 'broken/stream') {
            socket.write(serverFrame(JSON.stringify({ type: 'error', streamId: frame.json.streamId, error: { code: 'gateway/unknown', message: 'No such stream.', details: {} } })));
          }
          if (frame.json.endpoint === 'hangs/stream') {
            // One item, then silence: the consumer must cancel when it stops early.
            socket.write(serverFrame(JSON.stringify({ type: 'item', streamId: frame.json.streamId, value: { first: true } })));
          }
        }
        if (frame.json?.type === 'cancel') cancelled.push(frame.json.streamId);
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const bridge = {
    async requestJson(id, path, payload) {
      return new Promise((resolve, reject) => {
        const request = httpRequest({ hostname: '127.0.0.1', port, method: 'POST', path, headers: { 'content-type': 'application/json' }, agent: false }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, value: JSON.parse(Buffer.concat(chunks).toString()) }));
        });
        request.on('error', reject);
        request.end(JSON.stringify(payload));
      });
    },
    upgrade() {
      return new Promise((resolve, reject) => {
        const key = Buffer.alloc(16, 7).toString('base64');
        const request = httpRequest({ hostname: '127.0.0.1', port, method: 'GET', path: '/api/remote.mux', headers: { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-version': '13', 'sec-websocket-key': key }, agent: false });
        request.on('upgrade', (response, socket, head) => resolve({ socket, head }));
        request.on('error', reject);
        request.end();
      });
    },
  };
  const client = new TargetClient({ targetId: 'target-1', bridge, connectionId: 'connection-1' });
  t.after(async () => {
    await client.close();
    for (const socket of peers) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  });
  return { client, unary, opened, cancelled, peers };
}

test('a unary call rides the envelope the remote DSH expects', async t => {
  const { client, unary } = await fixture(t);
  const value = await client.call('session/list', { _request: {} });
  assert.equal(value.items[0].sessionId, 's-1');
  const seen = unary.at(-1);
  assert.equal(seen.url, '/api/session/list', 'the endpoint travels in the path');
  assert.deepEqual(seen.body.payload, { args: { _request: {} } });
  assert.equal(seen.body.method, 'session/list');
});

test('a remote failure becomes a typed error', async t => {
  const { client } = await fixture(t);
  await assert.rejects(() => client.call('workspace/create', { path: '/nope' }), error => {
    assert.ok(error instanceof RemoteFailure);
    assert.equal(error.code, 'workspace/invalid-path');
    assert.match(error.message, /not usable/);
    return true;
  });
});

test('plugin routes pass their payload through unwrapped', async t => {
  const { client, unary } = await fixture(t);
  const value = await client.pluginCall('t3-session-sidebar/snapshot', { epoch: 'epoch-1', revision: 2 });
  assert.equal(value.contract, 1);
  assert.deepEqual(unary.at(-1).body.payload, { epoch: 'epoch-1', revision: 2 });
});

test('follow yields every item and ends', async t => {
  const { client, opened } = await fixture(t);
  const items = [];
  for await (const item of client.follow('workspace/follow', {})) items.push(item);
  assert.equal(items.length, 2);
  assert.deepEqual(items[1], { type: 'upsert', workspace: { workspaceId: 'w-2', path: '/srv/other' } });
  assert.deepEqual(opened.map(entry => entry.endpoint), ['workspace/follow']);
  assert.deepEqual(opened[0].payload, { args: {} });
  assert.ok(opened[0].streamId);
});

test('stopping early cancels the stream on the wire', async t => {
  const { client, opened, cancelled } = await fixture(t);
  for await (const item of client.follow('hangs/stream', {})) { void item; break; }
  await until(() => cancelled.length === 1, 'the cancel frame never arrived');
  assert.equal(opened.length, 1);
  assert.deepEqual(cancelled, [opened[0].streamId]);
});

test('an aborted signal stops a silent stream', async t => {
  const { client, cancelled, opened } = await fixture(t);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  await assert.rejects(async () => {
    for await (const item of client.follow('silent/stream', {}, { signal: controller.signal })) void item;
  }, error => {
    assert.equal(error.code, 'remote/cancelled');
    return true;
  });
  await until(() => cancelled.length === 1, 'the cancel frame never arrived');
  assert.equal(opened.length, 1);
  assert.deepEqual(cancelled, [opened[0].streamId]);
});

test('a stream error surfaces as a typed failure', async t => {
  const { client } = await fixture(t);
  await assert.rejects(async () => { for await (const item of client.follow('broken/stream', {})) void item; }, error => {
    assert.equal(error.code, 'gateway/unknown');
    return true;
  });
});

test('two streams share one connection', async t => {
  const { client } = await fixture(t);
  const workspaces = [];
  const controls = [];
  const left = (async () => { for await (const item of client.follow('workspace/follow', {})) workspaces.push(item); })();
  const right = (async () => { for await (const item of client.follow('session/control', {})) { controls.push(item); break; } })();
  await left;
  await right;
  assert.equal(workspaces.length, 2);
  assert.equal(controls.length, 1);
  assert.equal(controls[0].value.projections['s-1'].values.title, 'Deploy fix');
});

test('a dropped connection fails the open streams', async t => {
  const { client, peers } = await fixture(t);
  const run = (async () => { const seen = []; for await (const item of client.follow('session/control', {})) seen.push(item); return seen; })();
  await new Promise(resolve => setTimeout(resolve, 100));
  for (const socket of peers) socket.destroy();
  await assert.rejects(run, error => {
    assert.equal(error.code, 'remote/stream-closed');
    return true;
  });
});

test('a closed client refuses further calls', async t => {
  const { client } = await fixture(t);
  await client.close();
  await assert.rejects(() => client.follow('workspace/follow', {}).next(), /closed/);
});

test('endpoint names are validated before anything leaves the host', async t => {
  const { client, unary } = await fixture(t);
  await assert.rejects(() => client.call('../etc', {}), /Invalid Remote endpoint/);
  await assert.rejects(() => client.call('session/list', []), /plain object/);
  assert.equal(unary.length, 0);
});
