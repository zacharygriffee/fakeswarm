import test from 'brittle';
import { createFakeSwarm } from '../src/index.js';
import { once, sleep, waitFor } from './helpers.js';
import b4a from "b4a";

const makeTopic = (ch) => b4a.alloc(32, ch.charCodeAt(0));

// Basic connect and data flow
test('basic connect sends data', async (t) => {
  const topics = new Map();
  const swarmA = createFakeSwarm(b4a.alloc(32, 1), topics);
  const swarmB = createFakeSwarm(b4a.alloc(32, 2), topics);

  const topic = makeTopic('a');
  swarmA.join(topic);
  swarmB.join(topic);

  const [socketA, infoA] = await once(swarmA, 'connection', 500);
  const [socketB, infoB] = await once(swarmB, 'connection', 500);

  t.is(Buffer.isBuffer(infoA.publicKey), true, 'peerInfoA has publicKey');
  t.is(Buffer.isBuffer(infoB.publicKey), true, 'peerInfoB has publicKey');
  t.alike(socketA.remotePublicKey, infoA.publicKey, 'socketA remotePublicKey set');
  t.alike(socketB.remotePublicKey, infoB.publicKey, 'socketB remotePublicKey set');

  const message = b4a.from('hello');
  const recv = once(socketB, 'data', 200);
  socketA.write(message);
  const data = await recv;

  t.alike(data, message);

  await swarmA.close();
  await swarmB.close();
});

// No self-connection
test('does not connect to self', async (t) => {
  const topics = new Map();
  const swarm = createFakeSwarm(b4a.alloc(32, 3), topics);
  swarm.join(makeTopic('b'));

  const gotConnection = once(swarm, 'connection', 80).then(() => true).catch(() => false);

  await swarm.flush(40);
  await sleep(40);

  t.is(await gotConnection, false);
  await swarm.close();
});

// Leave prevents new connections
test('leave prevents new connections', async (t) => {
  const topics = new Map();
  const swarm1 = createFakeSwarm(b4a.alloc(32, 4), topics);
  const swarm2 = createFakeSwarm(b4a.alloc(32, 5), topics);
  const topic = makeTopic('c');

  swarm1.join(topic);
  const { leave } = swarm2.join(topic);

  leave(); // unpublish before any listeners see a connection

  const got = once(swarm1, 'connection', 120).then(() => true).catch(() => false);
  await swarm1.flush(80);
  await sleep(60);

  t.is(await got, false);

  await swarm1.close();
  await swarm2.close();
});

// Close cleanup: unpublish and no ghost peers
test('close cleans up topics and sockets', async (t) => {
  const topics = new Map();
  const swarm1 = createFakeSwarm(b4a.alloc(32, 6), topics);
  const swarm2 = createFakeSwarm(b4a.alloc(32, 7), topics);
  const topic = makeTopic('d');

  swarm1.join(topic);
  swarm2.join(topic);

  // Wait for a connection to be established
  await once(swarm1, 'connection', 500);
  await once(swarm2, 'connection', 500);

  await swarm1.close();

  // connection map cleared
  t.is(swarm1.connections.size, 0);

  // no ghost entries in topics map
  const ghost = Array.from(topics.values()).some((peers) => peers.has(swarm1.id));
  t.is(ghost, false);

  // closing peer should not receive new connections
  const swarm3 = createFakeSwarm(b4a.alloc(32, 8), topics);
  swarm3.join(topic);
  const got = once(swarm1, 'connection', 120).then(() => true).catch(() => false);
  await swarm3.flush(80);
  t.is(await got, false);

  await swarm2.close();
  await swarm3.close();
});

// Backfill behavior: emits existing connections to the first listener
test('backfills existing connections when first listener is added', async (t) => {
  const topics = new Map();
  const swarm1 = createFakeSwarm(b4a.alloc(32, 9), topics);
  const swarm2 = createFakeSwarm(b4a.alloc(32, 10), topics);
  const topic = makeTopic('e');

  swarm1.join(topic);
  swarm2.join(topic);

  // Let connections establish without listeners
  const established = await waitFor(
    () => swarm1.connections.size === 1 && swarm2.connections.size === 1,
    400,
    10
  );
  t.ok(established, 'connections established');

  const got = once(swarm1, 'connection', 200).then(() => true).catch(() => false);
  t.is(await got, true, 'connection event backfilled to first listener');

  await swarm1.close();
  await swarm2.close();
});

test('discovery handle and update events', async (t) => {
  const topics = new Map();
  const swarm1 = createFakeSwarm(b4a.alloc(32, 11), topics);
  const swarm2 = createFakeSwarm(b4a.alloc(32, 12), topics);
  const topic = makeTopic('f');

  const discovery = swarm1.join(topic);
  t.ok(discovery && typeof discovery.leave === 'function', 'has leave');
  t.ok(typeof discovery.destroy === 'function', 'has destroy');
  t.ok(typeof discovery.flushed === 'function', 'has flushed');
  t.ok(typeof discovery.refresh === 'function', 'has refresh');

  const updates = [];
  swarm1.on('update', () => updates.push('u'));

  swarm2.join(topic);

  const connected = await once(swarm1, 'connection', 500).then(() => true).catch(() => false);
  t.is(connected, true);

  // destroy should unpublish and prevent new connects after close
  await discovery.destroy();
  await swarm1.close();
  await swarm2.close();

  t.ok(updates.length >= 1, 'update fired on connection lifecycle');
});

test('client-only dials server-only on shared topic', async (t) => {
  const topics = new Map();
  const client = createFakeSwarm(b4a.alloc(32, 13), topics);
  const server = createFakeSwarm(b4a.alloc(32, 14), topics);
  const topic = makeTopic('g');

  client.join(topic, { client: true, server: false });
  server.join(topic, { client: false, server: true });

  const gotClient = once(client, 'connection', 300);
  const gotServer = once(server, 'connection', 300);

  const [clientSocket, clientInfo] = await gotClient;
  const [serverSocket, serverInfo] = await gotServer;

  t.is(clientInfo.initiator, true, 'client side initiator true');
  t.is(serverInfo.initiator, false, 'server side initiator false');
  t.alike(clientSocket.remotePublicKey, clientInfo.publicKey, 'client socket remotePublicKey set');
  t.alike(serverSocket.remotePublicKey, serverInfo.publicKey, 'server socket remotePublicKey set');

  // Basic data round-trip
  const recv = once(serverSocket, 'data', 200);
  clientSocket.write(b4a.from('ping'));
  const data = await recv;
  t.alike(data, b4a.from('ping'));

  await client.close();
  await server.close();
});

test('client-only vs client-only yields no connections', async (t) => {
  const topics = new Map();
  const a = createFakeSwarm(b4a.alloc(32, 15), topics);
  const b = createFakeSwarm(b4a.alloc(32, 16), topics);
  const topic = makeTopic('h');

  a.join(topic, { client: true, server: false });
  b.join(topic, { client: true, server: false });

  const got = once(a, 'connection', 200).then(() => true).catch(() => false);
  await a.flush(120);
  await b.flush(120);
  await sleep(120);
  t.is(await got, false);

  await a.close();
  await b.close();
});

test('server-only vs server-only yields no connections', async (t) => {
  const topics = new Map();
  const a = createFakeSwarm(b4a.alloc(32, 17), topics);
  const b = createFakeSwarm(b4a.alloc(32, 18), topics);
  const topic = makeTopic('i');

  a.join(topic, { client: false, server: true });
  b.join(topic, { client: false, server: true });

  const got = once(a, 'connection', 200).then(() => true).catch(() => false);
  await a.flush(120);
  await b.flush(120);
  await sleep(120);
  t.is(await got, false);

  await a.close();
  await b.close();
});
