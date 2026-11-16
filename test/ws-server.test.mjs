import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { WebSocketServer } from '../src/integrations/ws-server.mjs';
import { maskedFrame, rawClient } from './helpers/ws-client.mjs';

async function fixture(t, { maxPayload = 1024 * 1024, onConnection = ws => ws.on('message', data => ws.send(data.toString())) } = {}) {
  const wss = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  const server = createServer((_req, res) => { res.writeHead(400); res.end(); });
  const sockets = new Set();
  let connection;
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, ws => {
    connection = ws;
    ws.on('error', () => {});
    onConnection(ws);
  }));
  t.after(async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all([new Promise(resolve => wss.close(resolve)), new Promise(resolve => server.close(resolve))]);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `ws://127.0.0.1:${server.address().port}`, get connection() { return connection; }, wss };
}

async function expectClose(client, code) {
  const frame = await client.readFrame();
  assert.equal(frame.opcode, 8);
  assert.equal(frame.payload.readUInt16BE(0), code);
  await client.closed;
}

test('WebSocket opening handshake has the RFC accept value and negotiates no optional features', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url, { headers: { Connection: 'keep-alive, Upgrade',
    'Sec-WebSocket-Extensions': 'permessage-deflate', 'Sec-WebSocket-Protocol': 'fixture' } });
  assert.equal(client.status, 101);
  assert.equal(client.headers['sec-websocket-accept'], 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.equal(client.headers.upgrade.toLowerCase(), 'websocket');
  assert.equal(client.headers.connection.toLowerCase(), 'upgrade');
  assert.equal(client.headers['sec-websocket-extensions'], undefined);
  assert.equal(client.headers['sec-websocket-protocol'], undefined);
  assert.equal(f.connection.readyState, 1);
  assert.equal(typeof f.connection.bufferedAmount, 'number');
});

for (const [name, headers, method] of [
  ['missing key', { 'Sec-WebSocket-Key': null }],
  ['invalid key', { 'Sec-WebSocket-Key': 'not-a-key' }],
  ['wrong key length', { 'Sec-WebSocket-Key': Buffer.alloc(15).toString('base64') }],
  ['wrong version', { 'Sec-WebSocket-Version': '12' }],
  ['wrong method', {}, 'POST'],
]) test(`WebSocket rejects a handshake with ${name}`, { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url, { headers, method });
  assert.equal(client.status, 400);
  await client.closed;
  assert.equal(f.connection, undefined);
});

for (const [name, length, lengthForm] of [['short', 9, 7], ['16-bit', 256, 16], ['64-bit', 65536, 64]]) {
  test(`WebSocket echoes ${name} text frames in both directions`, { timeout: 5000 }, async t => {
    const f = await fixture(t);
    const client = await rawClient(t, f.url);
    const text = 'x'.repeat(length);
    client.socket.write(maskedFrame(text));
    const frame = await client.readFrame();
    assert.equal(frame.opcode, 1);
    assert.equal(frame.fin, true);
    assert.equal(frame.masked, false);
    assert.equal(frame.lengthForm, lengthForm);
    assert.equal(frame.payload.toString(), text);
  });
}

test('WebSocket reassembles fragmented messages and handles interleaved ping', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url);
  client.socket.write(Buffer.concat([
    maskedFrame('hello ', { fin: false }), maskedFrame('pulse', { opcode: 9 }), maskedFrame('world', { opcode: 0 }),
  ]));
  const pong = await client.readFrame();
  assert.equal(pong.opcode, 10);
  assert.equal(pong.payload.toString(), 'pulse');
  assert.equal((await client.readFrame()).payload.toString(), 'hello world');
});

test('WebSocket ignores pong and echoes an empty message', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url);
  client.socket.write(Buffer.concat([maskedFrame('ignored', { opcode: 10 }), maskedFrame('')]));
  const frame = await client.readFrame();
  assert.equal(frame.opcode, 1);
  assert.equal(frame.payload.length, 0);
});

test('WebSocket delivers binary messages as Buffer with the binary flag', { timeout: 5000 }, async t => {
  let received;
  const f = await fixture(t, { onConnection: ws => ws.on('message', (data, isBinary) => {
    received = { data, isBinary };
    ws.send('received');
  }) });
  const client = await rawClient(t, f.url);
  client.socket.write(maskedFrame(Buffer.from([0, 255, 2]), { opcode: 2 }));
  await client.readFrame();
  assert.deepEqual(received, { data: Buffer.from([0, 255, 2]), isBinary: true });
});

test('WebSocket echoes close and ends the socket', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url);
  const payload = Buffer.from([0x03, 0xe8, 0x62, 0x79, 0x65]);
  const serverClosed = new Promise(resolve => f.connection.once('close', resolve));
  client.socket.write(maskedFrame(payload, { opcode: 8 }));
  const frame = await client.readFrame();
  assert.equal(frame.opcode, 8);
  assert.deepEqual(frame.payload, payload);
  await Promise.all([client.closed, serverClosed]);
  assert.equal(f.connection.readyState, 3);
});

for (const [name, frame] of [
  ['unmasked data', maskedFrame('bad', { masked: false })],
  ['unmasked empty frame', maskedFrame('', { masked: false })],
  ['RSV bits', maskedFrame('bad', { rsv: 0x40 })],
  ['unknown opcode', maskedFrame('bad', { opcode: 3 })],
  ['fragmented control', maskedFrame('bad', { opcode: 9, fin: false })],
  ['oversize control', maskedFrame('x'.repeat(126), { opcode: 9 }).subarray(0, 4)],
  ['unexpected continuation', maskedFrame('bad', { opcode: 0 })],
  ['one-byte close payload', maskedFrame(Buffer.from([0]), { opcode: 8 })],
  ['interrupted fragmented message', Buffer.concat([maskedFrame('one', { fin: false }), maskedFrame('two')])],
]) test(`WebSocket rejects ${name} with 1002`, { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url);
  client.socket.write(frame);
  await expectClose(client, 1002);
});

for (const lengthForm of [16, 64]) test(`WebSocket rejects an oversize ${lengthForm}-bit frame before receiving its payload`, { timeout: 5000 }, async t => {
  const f = await fixture(t, { maxPayload: 128 });
  const client = await rawClient(t, f.url);
  client.socket.write(maskedFrame('x'.repeat(lengthForm === 16 ? 256 : 65536), { lengthForm }).subarray(0, lengthForm === 16 ? 4 : 10));
  await expectClose(client, 1009);
});

test('WebSocket rejects an oversize reassembled message before receiving the continuation payload', { timeout: 5000 }, async t => {
  const f = await fixture(t, { maxPayload: 128 });
  const client = await rawClient(t, f.url);
  client.socket.write(Buffer.concat([maskedFrame('x'.repeat(100), { fin: false }), maskedFrame('x'.repeat(100), { opcode: 0 }).subarray(0, 2)]));
  await expectClose(client, 1009);
});

test('WebSocket handles frame headers, masks, and payloads split across writes', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url);
  const frame = maskedFrame('x'.repeat(256));
  for (const [start, end] of [[0, 1], [1, 3], [3, 5], [5, 9], [9, frame.length]]) {
    client.socket.write(frame.subarray(start, end));
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal((await client.readFrame()).payload.toString(), 'x'.repeat(256));
});

test('WebSocket handles two frames in one write', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url);
  client.socket.write(Buffer.concat([maskedFrame('one'), maskedFrame('two')]));
  assert.equal((await client.readFrame()).payload.toString(), 'one');
  assert.equal((await client.readFrame()).payload.toString(), 'two');
});

test('WebSocket processes a frame already present in the HTTP upgrade head', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const client = await rawClient(t, f.url, { head: maskedFrame('head') });
  assert.equal((await client.readFrame()).payload.toString(), 'head');
});

test('WebSocket terminate closes its socket and server close closes remaining connections', { timeout: 5000 }, async t => {
  const f = await fixture(t);
  const first = await rawClient(t, f.url);
  const connection = f.connection;
  // The client can see its socket close before the server end has finished closing
  // (on Windows it always does), so wait for both ends before checking the state.
  const connectionClosed = new Promise(resolve => connection.once('close', resolve));
  connection.terminate();
  await Promise.all([first.closed, connectionClosed]);
  assert.equal(connection.readyState, 3);
  const second = await rawClient(t, f.url);
  await new Promise(resolve => f.wss.close(resolve));
  await second.closed;
  assert.equal(f.connection.readyState, 3);
});
