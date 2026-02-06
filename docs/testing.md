# Testing notes

Tests use [brittle](https://github.com/holepunchto/brittle) and live in `test/`.

## Helpers
- `sleep(ms)`: simple delay.
- `once(emitter, event, timeoutMs)`: Promise that resolves with event args or rejects on timeout.
- `waitFor(fn, timeoutMs, intervalMs)`: polls until `fn()` returns truthy or times out.

## Coverage
- **Basic connect**: two swarms join the same topic, exchange a message, and verify payload.
- **No self-connection**: a swarm never emits a connection to itself.
- **Leave prevents new connections**: leaving before listeners prevents subsequent connects.
- **Close cleanup**: closing unpublishes topics, clears `connections`, and does not emit new connections after close.
- **Backfill**: adding the first `connection` listener after a connection already exists re-emits it.
- **Update event & discovery handle**: `update` fires on connect/disconnect; discovery handle methods are present and no-op as expected.
- **Client/server mode opts**: client-only vs server-only connects; client-only vs client-only and server-only vs server-only do not connect.

## Debugging tips
- Run a single test: `npx brittle test/basic.test.js -m "basic connect"`.
- Increase timeouts by temporarily editing helper defaults if your environment is slow.
- Add `console.log` inside tests or within `src/index.js` tick/flush to trace dial flow; remember to remove before publishing.
