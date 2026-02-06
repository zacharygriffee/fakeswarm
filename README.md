# fakeswarm

Deterministic, single-process, in-memory fake of a Hyperswarm-like swarm. Useful for tests, examples, or labs where you need predictable peer connections without any real DHT, NAT, or network traffic.

**What it is**
- In-memory swarm that pairs peers by shared topics in a shared Map.
- Deterministic dial election so only one side initiates.
- Uses `@hyperswarm/secret-stream` Noise streams for realistic socket shape.

**What it is not**
- No real networking, NAT traversal, DHT, peer discovery, or reconnection logic.
- Not a drop-in for production Hyperswarm; it is a lab fake.

## Install

```bash
npm install fakeswarm
```

## Quickstart

Two swarms join the same topic and exchange a message:

```js
import { createFakeSwarm } from 'fakeswarm';
import crypto from 'crypto';

const topic = crypto.randomBytes(32);
const swarmA = createFakeSwarm();
const swarmB = createFakeSwarm();

swarmA.join(topic);
swarmB.join(topic);

swarmB.on('connection', (socket, peerInfo) => {
  socket.on('data', (data) => {
    console.log('B got:', data.toString(), 'from', peerInfo.id);
  });
});

swarmA.on('connection', (socket) => {
  socket.write('hello');
});
```

Always call `close()` when done to unpublish topics and destroy sockets.

## API

### createFakeSwarm(seed?, topics?)
- `seed` (Buffer | Uint8Array | null): optional seed passed to `hypercore-crypto.keyPair` for deterministic keys.
- `topics` (Map) optional shared topics map. By default a module-level Map is used so multiple swarms share the same space.

Returns an object with:
- `join(topic, opts?)` -> discovery handle: joins a topic (Buffer). `opts` mirrors Hyperswarm with defaults `{ server: true, client: true }`.
  - If `server: false`, the swarm will not publish/accept on this topic.
  - If `client: false`, the swarm will not dial on this topic.
  - Handle exposes `leave()` / `destroy()` (unpublish), and `refresh()` / `flushed()` (immediate no-ops for parity).
- `leave(topic)`: unpublish without the handle.
- `connections`: `Map<peerId, { socket, peerInfo }>` of active sockets.
- `topics`: Set of encoded topics joined (any mode).
- `on(event, fn)` / `off(event, fn)`: EventEmitter style. Events:
  - `connection` `(socket, peerInfo)` where `peerInfo = { publicKey, id, initiator }`.
  - `close` when the swarm closes.
  - `update` when the connection set changes.
- `flush(timeoutMs?)`: wait (best-effort) for in-flight dials to settle; useful in tests to let the tick loop quiesce.
- `close()` / `destroy()`: unpublish, stop ticking, destroy sockets, and emit `close`.
- `keyPair`: the generated keypair.
- `id`: `idEncoding.encode(publicKey)` convenience string.

### Join / leave semantics
- Joining registers this swarm in the shared topics map; peers that share a topic will connect.
- Leaving (or closing) removes the entry from the shared map to avoid ghost peers.

### Determinism notes
- Dial election: only the lexicographically smaller peerId initiates (`peerId < remotePeerId`), preventing double connects.
- Backfill: the first `connection` listener added receives existing connections immediately (if any).
- Flush: waits for connecting dials to drain; it does not advance time on its own.

### Resource cleanup
- Always call `close()` (or `destroy()`) to unpublish topics and destroy sockets.
- `flush()` can be used in tests to wait until the swarm has no in-flight dials before asserting.

## Limitations
- No NAT traversal, DHT, hole-punching, or real network I/O.
- No reconnection, banning, or peer prioritization.
- No peer discovery beyond the shared in-memory topics map you provide.
- Single-process only; for multi-process/multi-machine tests use real Hyperswarm.

## License
MIT
