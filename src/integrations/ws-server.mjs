import { EventEmitter } from 'node:events';
import { createHash } from 'node:crypto';

function frame(opcode, payload) {
  const length = payload.length, extra = length < 126 ? 0 : length <= 65535 ? 2 : 8;
  const header = Buffer.alloc(2 + extra);
  header[0] = 0x80 | opcode;
  header[1] = extra === 0 ? length : extra === 2 ? 126 : 127;
  if (extra === 2) header.writeUInt16BE(length, 2);
  if (extra === 8) header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

class Connection extends EventEmitter {
  constructor(socket, maxPayload) {
    super();
    this.readyState = 1;
    this.socket = socket;
    const header = Buffer.alloc(14);
    let used = 0, needed = 2, validated = false, current = null;
    let fragments = [], messageBytes = 0, messageOpcode = 0;
    const finish = (payload) => {
      this.readyState = 2;
      fragments = []; current = null;
      socket.end(frame(8, payload));
    };
    const reject = (code) => { const payload = Buffer.alloc(2); payload.writeUInt16BE(code); finish(payload); };
    this.consume = (chunk) => {
      try {
        let offset = 0;
        while (this.readyState === 1 && (offset < chunk.length || current?.length === 0)) {
          if (!current) {
            const count = Math.min(needed - used, chunk.length - offset);
            chunk.copy(header, used, offset, offset + count); used += count; offset += count;
            if (used < needed) return;
            if (needed === 2) {
              const opcode = header[0] & 15, fin = !!(header[0] & 128), control = opcode >= 8;
              const size = header[1] & 127;
              if (header[0] & 112 || !(header[1] & 128) || ![0, 1, 2, 8, 9, 10].includes(opcode) ||
                  control && (!fin || size > 125) || opcode === 0 && !messageOpcode ||
                  !control && opcode !== 0 && messageOpcode) { reject(1002); return; }
              needed = 2 + (size === 126 ? 2 : size === 127 ? 8 : 0);
              if (used < needed) continue;
            }
            const opcode = header[0] & 15, fin = !!(header[0] & 128), size = header[1] & 127;
            const control = opcode >= 8;
            const length = size === 127 ? header.readBigUInt64BE(2) : BigInt(size === 126 ? header.readUInt16BE(2) : size);
            if (!validated) {
              if (length >> 63n || size === 126 && length < 126n || size === 127 && length < 65536n) { reject(1002); return; }
              // Reject oversized declarations before waiting for a mask or allocating payload bytes.
              if (length > BigInt(maxPayload) || !control && length + BigInt(messageBytes) > BigInt(maxPayload)) { reject(1009); return; }
              validated = true; needed += 4;
              if (used < needed) continue;
            }
            current = { opcode, fin, length: Number(length), used: 0, mask: Buffer.from(header.subarray(needed - 4, needed)), payload: Buffer.alloc(Number(length)) };
            used = 0; needed = 2; validated = false;
          }
          const count = Math.min(current.length - current.used, chunk.length - offset);
          chunk.copy(current.payload, current.used, offset, offset + count); current.used += count; offset += count;
          if (current.used < current.length) return;
          const { opcode, fin, payload, mask } = current;
          current = null;
          for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
          if (opcode === 8) { if (payload.length === 1) reject(1002); else finish(payload); return; }
          if (opcode === 9) { socket.write(frame(10, payload)); continue; }
          if (opcode === 10) continue;
          if (opcode !== 0) messageOpcode = opcode;
          fragments.push(payload); messageBytes += payload.length;
          if (fin) {
            const data = fragments.length === 1 ? payload : Buffer.concat(fragments, messageBytes), binary = messageOpcode === 2;
            fragments = []; messageBytes = 0; messageOpcode = 0;
            this.emit('message', data, binary);
          }
        }
      } catch { this.terminate(); }
    };
    socket.on('data', this.consume);
    socket.on('error', (error) => { this.terminate(); if (this.listenerCount('error')) this.emit('error', error); });
    socket.once('end', () => this.terminate());
    socket.once('close', () => { this.readyState = 3; fragments = []; current = null; this.emit('close'); });
  }
  get bufferedAmount() { return this.socket.writableLength; }
  send(text, callback) {
    if (this.readyState !== 1) { callback?.(new Error('WebSocket is not open.')); return; }
    this.socket.write(frame(1, Buffer.from(text)), callback);
  }
  terminate() { if (this.readyState !== 3) this.readyState = 2; this.socket.destroy(); }
}

export class WebSocketServer extends EventEmitter {
  constructor({ noServer, maxPayload = 100 * 1024 * 1024, perMessageDeflate } = {}) {
    super();
    if (!noServer) throw new Error('Only noServer WebSocket mode is supported.');
    this.maxPayload = maxPayload;
    this.connections = new Set();
  }
  handleUpgrade(req, socket, head, callback) {
    const key = req.headers['sec-websocket-key'];
    if (req.method !== 'GET' || req.headers.upgrade?.toLowerCase() !== 'websocket' ||
        !req.headers.connection?.split(',').some(value => value.trim().toLowerCase() === 'upgrade') ||
        req.headers['sec-websocket-version'] !== '13' || typeof key !== 'string' ||
        !/^[A-Za-z0-9+/]{22}==$/.test(key) || Buffer.from(key, 'base64').length !== 16) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n', () => socket.destroy());
      return;
    }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const connection = new Connection(socket, this.maxPayload);
    this.connections.add(connection);
    connection.once('close', () => this.connections.delete(connection));
    callback(connection);
    if (head.length) connection.consume(head);
  }
  close(callback) {
    const connections = [...this.connections];
    if (!connections.length) { queueMicrotask(() => callback?.()); return; }
    let remaining = connections.length;
    for (const connection of connections) {
      connection.once('close', () => { if (--remaining === 0) callback?.(); });
      connection.terminate();
    }
  }
}
