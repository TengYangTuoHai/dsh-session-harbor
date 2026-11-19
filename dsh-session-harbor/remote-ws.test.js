import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketClient } from './remote-ws.js';

const test = (name, run) => nodeTest(name, { timeout: 5000 }, run);
const MASK = Buffer.from([0x12, 0x34, 0x56, 0x78]);

class FakeSocket {
  constructor(head) {
    this.writes = [];
    this.handlers = {};
    this.ended = false;
    this.destroyed = false;
    this.head = head;
  }
  on(event, handler) { this.handlers[event] = handler; }
  write(chunk) { this.writes.push(Buffer.from(chunk)); return true; }
  end() { this.ended = true; }
  destroy() { this.destroyed = true; }
  feed(chunk) { this.handlers.data(Buffer.from(chunk)); }
  get sent() { return Buffer.concat(this.writes); }
}

function client(options = {}) {
  const socket = new FakeSocket();
  const messages = [];
  const closes = [];
  const errors = [];
  const ws = new WebSocketClient({
    socket,
    random: () => MASK,
    onMessage: text => messages.push(text),
    onClose: code => closes.push(code),
    onError: error => errors.push(error),
    ...options,
  });
  return { socket, ws, messages, closes, errors };
}

/** Build one unmasked server frame the way a server sends it. */
function frame(opcode, payload = Buffer.alloc(0), fin = true) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  let header;
  if (body.length < 126) { header = Buffer.alloc(2); header[1] = body.length; }
  else if (body.length <= 0xffff) { header = Buffer.alloc(4); header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  header[0] = (fin ? 0x80 : 0) | opcode;
  return Buffer.concat([header, body]);
}

/** Decode one masked client frame written by the client. */
function decode(buffer) {
  const fin = (buffer[0] & 0x80) !== 0;
  const opcode = buffer[0] & 0x0f;
  const length = buffer[1] & 0x7f;
  const mask = buffer.subarray(2, 6);
  const body = buffer.subarray(6);
  const payload = Buffer.alloc(body.length);
  for (let index = 0; index < body.length; index += 1) payload[index] = body[index] ^ mask[index & 3];
  return { fin, opcode, masked: (buffer[1] & 0x80) !== 0, payload };
}

test('decodes a single text frame', () => {
  const { socket, messages } = client();
  socket.feed(frame(1, 'hello'));
  assert.deepEqual(messages, ['hello']);
});

test('reassembles a fragmented text message', () => {
  const { socket, messages } = client();
  socket.feed(frame(1, '{"a":', false));
  socket.feed(frame(0, '"b"', false));
  socket.feed(frame(0, '}', true));
  assert.deepEqual(messages, ['{"a":"b"}']);
});

test('waits for the rest of a split frame', () => {
  const { socket, messages } = client();
  const whole = frame(1, 'split-message');
  socket.feed(whole.subarray(0, 5));
  assert.deepEqual(messages, []);
  socket.feed(whole.subarray(5));
  assert.deepEqual(messages, ['split-message']);
});

test('handles a prefilled head and a 16-bit length', () => {
  const body = 'x'.repeat(300);
  const socket = new FakeSocket();
  const messages = [];
  const ws = new WebSocketClient({ socket, random: () => MASK, onMessage: text => messages.push(text) });
  const whole = frame(1, body);
  socket.feed(whole.subarray(0, 3));
  socket.feed(whole.subarray(3));
  assert.deepEqual(messages, [body]);
  void ws;
});

test('answers a ping with a masked pong carrying the same payload', () => {
  const { socket, ws } = client();
  socket.feed(frame(9, 'hb'));
  const reply = decode(socket.sent);
  assert.equal(reply.opcode, 10);
  assert.equal(reply.masked, true, 'client frames must be masked');
  assert.equal(reply.payload.toString(), 'hb');
  assert.equal(ws.state, 'open');
});

test('send writes a masked text frame', () => {
  const { socket, ws } = client();
  ws.send('{"type":"open"}');
  const sent = decode(socket.sent);
  assert.deepEqual([sent.fin, sent.opcode, sent.masked], [true, 1, true]);
  assert.equal(sent.payload.toString('utf8'), '{"type":"open"}');
});

test('a masked server frame is a protocol error', () => {
  const { socket, errors } = client();
  const masked = Buffer.concat([frame(1, 'x').subarray(0, 1), Buffer.from([0x81]), Buffer.from(MASK), Buffer.from([0x00])]);
  socket.feed(masked);
  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /must not be masked/);
});

test('an oversized frame closes the connection with 1009', () => {
  const { socket, errors, closes } = client({ maxPayload: 8 });
  socket.feed(frame(1, 'way too many bytes for this cap'));
  assert.equal(closes.at(-1), 1009);
  assert.match(errors[0].message, /too large/);
});

test('a close frame ends the connection and echoes the close', () => {
  const { socket, ws, closes } = client();
  const body = Buffer.alloc(5);
  body.writeUInt16BE(1000, 0);
  Buffer.from('bye').copy(body, 2);
  socket.feed(frame(8, body));
  assert.deepEqual(closes, [1000]);
  assert.equal(ws.state, 'closed');
  const echoed = decode(socket.sent);
  assert.equal(echoed.opcode, 8);
});

test('binary frames are refused', () => {
  const { socket, errors } = client();
  socket.feed(frame(2, Buffer.from([1, 2, 3])));
  assert.match(errors[0].message, /Binary/);
});

test('close() sends a close frame and stops further sends', () => {
  const { socket, ws } = client();
  ws.close(1001, 'going away');
  const sent = decode(socket.sent);
  assert.equal(sent.opcode, 8);
  assert.equal(sent.payload.readUInt16BE(0), 1001);
  assert.equal(sent.payload.subarray(2).toString(), 'going away');
  assert.throws(() => ws.send('late'), /not open/);
});
