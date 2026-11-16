import { connect } from 'node:net';

export function maskedFrame(payload, { opcode = 1, fin = true, masked = true, lengthForm, rsv = 0 } = {}) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const form = lengthForm ?? (payload.length < 126 ? 7 : payload.length <= 65535 ? 16 : 64);
  const header = Buffer.alloc(2 + (form === 16 ? 2 : form === 64 ? 8 : 0) + (masked ? 4 : 0));
  header[0] = (fin ? 0x80 : 0) | rsv | opcode;
  header[1] = (masked ? 0x80 : 0) | (form === 16 ? 126 : form === 64 ? 127 : payload.length);
  if (form === 16) header.writeUInt16BE(payload.length, 2);
  if (form === 64) header.writeBigUInt64BE(BigInt(payload.length), 2);
  const body = Buffer.from(payload);
  if (masked) {
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
    mask.copy(header, header.length - 4);
    for (let i = 0; i < body.length; i++) body[i] ^= mask[i % 4];
  }
  return Buffer.concat([header, body]);
}

export async function rawClient(t, url, { headers = {}, head = Buffer.alloc(0), method = 'GET' } = {}) {
  const address = new URL(url);
  const socket = connect({ host: address.hostname, port: Number(address.port) });
  const closed = new Promise(resolve => socket.once('close', resolve));
  t.after(() => socket.destroy());
  let buffer = Buffer.alloc(0), response, handshakeDone = false, failure;
  const frames = [], pending = [];
  const fail = error => {
    failure = error;
    rejectHandshake(error);
    for (const entry of pending.splice(0)) { clearTimeout(entry.timer); entry.reject(error); }
  };
  let resolveHandshake, rejectHandshake;
  const handshake = new Promise((resolve, reject) => { resolveHandshake = resolve; rejectHandshake = reject; });
  const timer = setTimeout(() => { fail(new Error('WebSocket handshake timed out.')); socket.destroy(); }, 3000);
  socket.on('error', fail);
  socket.once('close', () => { clearTimeout(timer); fail(new Error('WebSocket socket closed.')); });
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    if (!handshakeDone) {
      const boundary = buffer.indexOf('\r\n\r\n');
      if (boundary < 0) return;
      const lines = buffer.subarray(0, boundary).toString().split('\r\n');
      response = { status: Number(/^HTTP\/1\.1 (\d+)/.exec(lines.shift())?.[1]), headers: {} };
      for (const line of lines) {
        const colon = line.indexOf(':');
        response.headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
      }
      handshakeDone = true;
      buffer = buffer.subarray(boundary + 4);
      clearTimeout(timer);
      resolveHandshake(response);
    }
    if (response.status !== 101) return;
    while (buffer.length >= 2) {
      const masked = Boolean(buffer[1] & 0x80), marker = buffer[1] & 0x7f;
      const lengthForm = marker === 126 ? 16 : marker === 127 ? 64 : 7;
      const offset = 2 + (lengthForm === 16 ? 2 : lengthForm === 64 ? 8 : 0);
      if (buffer.length < offset) return;
      const length = lengthForm === 16 ? buffer.readUInt16BE(2) : lengthForm === 64 ? Number(buffer.readBigUInt64BE(2)) : marker;
      const start = offset + (masked ? 4 : 0);
      if (buffer.length < start + length) return;
      const payload = Buffer.from(buffer.subarray(start, start + length));
      if (masked) for (let i = 0; i < payload.length; i++) payload[i] ^= buffer[offset + i % 4];
      const frame = { opcode: buffer[0] & 0x0f, fin: Boolean(buffer[0] & 0x80), masked, payload, lengthForm };
      buffer = buffer.subarray(start + length);
      const entry = pending.shift();
      if (entry) { clearTimeout(entry.timer); entry.resolve(frame); }
      else frames.push(frame);
    }
  });
  socket.once('connect', () => {
    const requestHeaders = { host: address.host, connection: 'Upgrade', upgrade: 'websocket',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '13' };
    for (const [name, value] of Object.entries(headers)) requestHeaders[name.toLowerCase()] = value;
    socket.write(Buffer.concat([Buffer.from([
      `${method} ${address.pathname || '/'}${address.search} HTTP/1.1`,
      ...Object.entries(requestHeaders).filter(([, value]) => value != null).map(([name, value]) => `${name}: ${value}`), '', '',
    ].join('\r\n')), head]));
  });
  const readFrame = () => {
    if (frames.length) return Promise.resolve(frames.shift());
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, timer: setTimeout(() => {
        pending.splice(pending.indexOf(entry), 1);
        reject(new Error('WebSocket frame timed out.'));
      }, 3000) };
      pending.push(entry);
    });
  };
  return { socket, ...await handshake, readFrame, closed };
}
