# Design

## Goals
- Deterministic, single-process stand-in for Hyperswarm suitable for unit tests and demos.
- Keep the public surface minimal: `createFakeSwarm(seed?, topics?)` returning an object with `connection` events and `join/leave` handles.
- Avoid extra swarm features (reconnect, ban lists, etc.).

## Connection model
- Each swarm owns a key pair (`hypercore-crypto.keyPair`) and derives a string `id` via `hypercore-id-encoding`.
- A shared `topics` Map maps encoded topic -> Map of peerId -> `{ makeConnection }`.
- Joining writes an entry to the shared map; leaving (or closing) removes it.
- Dial election is deterministic: only the lexicographically smaller `peerId` initiates. This prevents double-connect when both sides see each other.
- When dialing, the initiator calls the remote peer's `makeConnection` (the `_incoming` handler), which returns a Noise stream. We pair two `@hyperswarm/secret-stream` instances (`initiator`/`responder`) by piping their `rawStream`s together, so sockets behave like real Hyperswarm sockets (emit `open`, `data`, etc.).
- Connections are stored in `connections` as `{ socket, peerInfo }`. We attach `close`/`error` listeners to drop stale entries.

## Backfill behavior
- The first `connection` listener added receives existing connections immediately. This mirrors how some swarms re-emit on first listener so test code that registers late still gets the active sockets.

## Discovery handles
- `join(topic, { server=true, client=true })`:
  - `server` controls publishing/accepting on the topic.
  - `client` controls dialing on the topic.
- Returns a lightweight discovery handle exposing `leave/destroy`, plus `refresh()` and `flushed()` no-ops for Hyperswarm API parity so callers don’t need conditional code in tests.

## Tick loop
- A 10ms `tick()` scans shared topics and triggers dials when a local topic matches a remote peer. Guards prevent self-connect and duplicate connects (`connections` and `connecting` maps).

## Flush rationale
- Tests often need to wait until the swarm has finished attempting connects. `flush(timeoutMs)` waits for the `connecting` set to stay empty twice in a row (best effort) or until `timeoutMs` elapses. It does not advance time by itself; it just waits for the existing tick/dial work to quiesce.

## Cleanup
- `close()` sets `closing`, stops the tick timer, unpublishes all topics, waits for in-flight dials to settle, best-effort destroys sockets, clears `connections`, and emits `close`.
- `destroy()` is an alias for labs that expect it.

## Invariants
- No self-connections (peerId equality check early).
- At most one active connection per remote peerId in `connections`.
- Shared topics map has no ghost peers after `leave()` or `close()` (peers map entries are removed; empty topic maps are deleted).
- `peerInfo` shape is minimal: `{ publicKey, id, initiator }`, where `publicKey` is present for local side and for incoming if provided by the dialer.
