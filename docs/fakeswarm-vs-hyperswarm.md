# FakeSwarm vs Hyperswarm

This repo ships a deterministic in-memory **FakeSwarm** for tests. Below is a factual comparison against real **Hyperswarm** (per the provided docs). Use it to choose the right tool and to avoid assuming unsupported behaviors.

## Purpose & scope
- **FakeSwarm**: single-process lab fake; no network, DHT, NAT traversal, or reconnection logic. Designed for fast, deterministic tests and demos.
- **Hyperswarm**: production P2P swarm using HyperDHT; supports real discovery/announce, client/server roles, reconnection, banning, and more.

## Core API surface
| Capability | FakeSwarm | Hyperswarm |
| --- | --- | --- |
| Construct | `createFakeSwarm(seed?, topics?)` | `new Hyperswarm({ keyPair, seed, maxPeers, firewall, dht })` |
| Join topic | `join(topic, { server=true, client=true })` (opts honored for dial/publish) | `join(topic, { server=true, client=true })` |
| Leave topic | `leave(topic)` | `leave(topic)` (stop announce/lookup) |
| Direct peer dial | Not supported | `joinPeer(noisePublicKey)`, `leavePeer()` |
| Flush/quiesce | `flush(timeoutMs?)` waits for in-flight dials only | `flush()` waits for pending DHT announces & queued connects (heavyweight) |
| Close | `close()/destroy()` destroys sockets & unpublishes | `suspend()/resume()` plus normal close semantics on swarm |
| Events | `connection`, `close` | `connection`, `update`, `ban` |

## Connection & peer info
- **Socket**: Both emit Noise streams from `@hyperswarm/secret-stream`.
- **PeerInfo shape**:
  - FakeSwarm: minimal `{ publicKey, id, initiator }`; `publicKey` only when known (local and incoming side if provided), `id` is encoded key string, `initiator` reflects Noise initiator for *this side*.
  - Hyperswarm: full `PeerInfo` with `publicKey`, `topics` (when client), `prioritized`, `ban()` control, and reconnection metadata.
- **Connection tracking**:
  - FakeSwarm: `connections` is a `Map<peerId, { socket, peerInfo }>`; drops entries on `close/error`.
  - Hyperswarm: `connections` is a `Set`, `peers` is a `Map<publicKeyHex, PeerInfo>`; `connecting` count exposed.

## Discovery & topology
- FakeSwarm has no DHT. Peers are discovered only through the shared in-memory `topics` Map passed to `createFakeSwarm`. All swarms must live in the same process to see each other.
- Hyperswarm announces and queries topics on HyperDHT; supports client/server roles, refresh, suspend/resume, and operates across machines/networks.

## Determinism & dial election
- FakeSwarm: deterministic dial election (`peerId < remotePeerId`) to avoid double-connect; deterministic keypairs with `seed`; single tick loop every 10ms.
- Hyperswarm: non-deterministic network timing; reconnection/backoff strategies not modeled here.

## Lifecycle
- FakeSwarm: call `close()` to stop the tick, unpublish topics, destroy sockets; `flush()` is best-effort settling of the local dial queue only.
- Hyperswarm: `flush()` waits for DHT announces and queued connects; `suspend()`/`resume()` pause/restart discovery; `leave()` does not close existing connections.

## Missing in FakeSwarm (by design)
- DHT, NAT traversal, real network I/O
- Client/server mode flags, `PeerDiscovery` controls, `status()`
- Direct peer dialing (`joinPeer/leavePeer`)
- `update` and `ban` events, `firewall`/`maxPeers` enforcement, priorities/reconnects
- `peerInfo.topics`, prioritization, ban/unban
- Multiple connections per peer / multiplexing of topics

## When to use which
- Use **FakeSwarm** for: fast unit tests, deterministic demos, simulating minimal connection events without network flakiness.
- Use **Hyperswarm** for: anything involving real discovery, NAT traversal, reconnection, banning, or multi-process/multi-host scenarios.
