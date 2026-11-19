/**
 * Minimal RFC 6455 client framing over a duplex socket handed back by
 * `RemoteBridge.upgrade()`. Only what the Remote mux needs is implemented:
 * text frames, fragmentation, ping/pong, close, and payload caps.
 */

import { randomBytes } from 'node:crypto';

const GUID_MAX = 1024 * 1024;

export class WebSocketProtocolError extends Error {
  constructor(message, code = 1002) { super(message); this.code = code; this.name = 'WebSocketProtocolError'; }
}

function maskKey(random) {
  const bytes = random();
  if (!Buffer.isBuffer(bytes) || bytes.length !== 4) throw new Error('mask key must be four bytes');
  return bytes;
}

/** One client-side WebSocket connection; `onMessage` receives decoded text payloads. */
export class WebSocketClient {
  #socket;
  #buffer;
  #state = 'open';
  #fragment = null;
  #maxMessageBytes;
  #maxPayload;
  #random;
  #onMessage;
  #onClose;
  #onError;

  constructor({ socket, head, maxMessageBytes = 4 * 1024 * 1024, maxPayload = GUID_MAX, random, onMessage, onClose, onError }) {
    if (!socket || typeof socket.write !== 'function' || typeof socket.on !== 'function') throw new Error('a duplex socket is required');
    this.#socket = socket;
    this.#buffer = head && head.length ? Buffer.from(head) : Buffer.alloc(0);
    this.#maxMessageBytes = maxMessageBytes;
    this.#maxPayload = maxPayload;
    this.#random = random ?? (() => randomBytes(4));
    this.#onMessage = onMessage ?? (() => {});
    this.#onClose = onClose ?? (() => {});
    this.#onError = onError ?? (() => {});
    socket.on('data', chunk => this.#receive(chunk));
    socket.on('error', error => this.#fail(error));
    socket.on('close', () => this.#finish(1006));
    if (this.#buffer.length) this.#parse();
  }

  get state() { return this.#state; }

  /** Send one masked text frame. */
  send(text) {
    if (this.#state !== 'open') throw new WebSocketProtocolError('The WebSocket connection is not open.');
    this.#write(1, Buffer.from(String(text), 'utf8'));
  }

  close(code = 1000, reason = '') {
    if (this.#state !== 'open') return;
    this.#state = 'closing';
    const payload = closePayload(code, reason);
    try { this.#write(8, payload); } catch { /* the socket is already gone */ }
    this.#socket.end();
    this.#finish(code);
  }

  #finish(code) {
    if (this.#state === 'closed') return;
    this.#state = 'closed';
    this.#socket.destroy();
    this.#onClose(code);
  }

  #fail(error) {
    if (this.#state === 'closed') return;
    this.#onError(error);
    this.#finish(error instanceof WebSocketProtocolError ? error.code : 1006);
  }

  #write(opcode, payload) {
    const mask = maskKey(this.#random);
    const length = payload.length;
    let header;
    if (length < 126) { header = Buffer.alloc(2); header[1] = 0x80 | length; }
    else if (length <= 0xffff) { header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(length, 2); }
    else { header = Buffer.alloc(10); header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(length), 2); }
    header[0] = 0x80 | opcode;
    const masked = Buffer.allocUnsafe(length);
    for (let index = 0; index < length; index += 1) masked[index] = payload[index] ^ mask[index & 3];
    this.#socket.write(Buffer.concat([header, mask, masked]));
  }

  #receive(chunk) {
    this.#buffer = this.#buffer.length ? Buffer.concat([this.#buffer, chunk]) : Buffer.from(chunk);
    this.#parse();
  }

  #parse() {
    try {
      while (this.#state !== 'closed') {
        const frame = this.#readFrame();
        if (frame === undefined) return;
        if (!this.#handleFrame(frame)) return;
      }
    } catch (error) {
      // A protocol violation ends the connection with the RFC 6455 status code
      // instead of throwing into the socket's data handler.
      const code = error instanceof WebSocketProtocolError ? error.code : 1002;
      if (this.#state === 'open') {
        try { this.#write(8, closePayload(code, String(error?.message ?? '').slice(0, 120))); } catch { /* the socket is already gone */ }
      }
      this.#fail(error);
    }
  }

  /** Consume one frame from the buffer, or return undefined when more bytes are needed. */
  #readFrame() {
    const buffer = this.#buffer;
    if (buffer.length < 2) return undefined;
    const fin = (buffer[0] & 0x80) !== 0;
    const opcode = buffer[0] & 0x0f;
    if ((buffer[0] & 0x70) !== 0) throw new WebSocketProtocolError('Reserved WebSocket bits are set.');
    if (buffer[1] & 0x80) throw new WebSocketProtocolError('A server frame must not be masked.');
    let length = buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (buffer.length < 4) return undefined;
      length = buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (buffer.length < 10) return undefined;
      const wide = buffer.readBigUInt64BE(2);
      if (wide > BigInt(this.#maxPayload)) throw new WebSocketProtocolError('A WebSocket frame is too large.', 1009);
      length = Number(wide);
      offset = 10;
    }
    if (length > this.#maxPayload) throw new WebSocketProtocolError('A WebSocket frame is too large.', 1009);
    if (buffer.length < offset + length) return undefined;
    const payload = buffer.subarray(offset, offset + length);
    this.#buffer = buffer.subarray(offset + length);
    return { fin, opcode, payload };
  }

  /** @returns false when the connection stopped consuming frames. */
  #handleFrame({ fin, opcode, payload }) {
    if (opcode === 8) {
      const { code } = readClose(payload);
      try { this.#write(8, closePayload(code, '')); } catch { /* already down */ }
      this.#finish(code);
      return false;
    }
    if (opcode === 9) { this.#write(10, payload); return true; }
    if (opcode === 10) return true;
    if (opcode === 0x0 || opcode === 0x1 || opcode === 0x2) {
      if (opcode !== 0x0 && this.#fragment) throw new WebSocketProtocolError('A new data frame interrupted a fragmented message.');
      if (opcode === 0x2 && fin && !this.#fragment) throw new WebSocketProtocolError('Binary WebSocket frames are not supported.');
      this.#fragment = this.#fragment ? Buffer.concat([this.#fragment, payload]) : payload;
      if (this.#fragment.length > this.#maxMessageBytes) throw new WebSocketProtocolError('A WebSocket message is too large.', 1009);
      if (!fin) return true;
      const message = this.#fragment.toString('utf8');
      this.#fragment = null;
      this.#onMessage(message);
      return true;
    }
    throw new WebSocketProtocolError('Unsupported WebSocket opcode ' + String(opcode) + '.');
  }
}

function closePayload(code, reason) {
  const text = Buffer.from(String(reason ?? '').slice(0, 120), 'utf8');
  const payload = Buffer.alloc(2 + text.length);
  payload.writeUInt16BE(code, 0);
  text.copy(payload, 2);
  return payload;
}

function readClose(payload) {
  if (payload.length >= 2) {
    const code = payload.readUInt16BE(0);
    return { code, reason: payload.subarray(2).toString('utf8') };
  }
  return { code: 1005, reason: '' };
}
