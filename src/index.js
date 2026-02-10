import EventEmitter from "events";
import idEncoding from "hypercore-id-encoding";
import Krypto from "hypercore-crypto";
import NoiseStream from "@hyperswarm/secret-stream";
import { normalizeArgs } from "./normalize.js";

const defaultTopics = new Map();

function createFakeSwarm(seedOrOpts = undefined, topicsArg = defaultTopics) {
    const { seed, net, topics } = normalizeArgs(seedOrOpts, topicsArg);

    const reconnectRace = {
        enabled: !!net?.reconnectRace?.enabled,
        staleRetentionMs: net?.reconnectRace?.staleRetentionMs ?? 25,
        reconnectDelayMs: net?.reconnectRace?.reconnectDelayMs ?? 10,
        duplicateConnection: !!net?.reconnectRace?.duplicateConnection
    };

    const keyPair = Krypto.keyPair(seed);
    const peerId = idEncoding.encode(keyPair.publicKey);

    // remotePeerId -> { socket, peerInfo }
    const connections = new Map();

    // remotePeerId -> Promise<void> (prevents duplicate concurrent dials)
    const connecting = new Map();

    // remotePeerId -> array of stale sockets kept temporarily
    const staleSockets = new Map();

    // timers we await during flush/close for determinism
    const retentionTimers = new Set();
    const reconnectTimers = new Set();

    const emitter = new EventEmitter();
    const joinedTopics = new Set();     // all topics we joined (regardless of mode)
    const dialTopics = new Set();       // topics where we will attempt outbound dials (client mode)
    const publishedTopics = new Set();  // topics we publish into the shared map (server mode)

    let closed = false;
    let closing = false;

    // only used for backfilling existing connections to the *first* connection listener
    let didBackfillConnections = false;

    function join(topic, opts = {}) {
        if (closing || closed) return;
        const topicId = idEncoding.encode(topic);
        const { server = true, client = true } = opts ?? {};
        joinedTopics.add(topicId);

        if (client) dialTopics.add(topicId);
        else dialTopics.delete(topicId);

        // Publish only in server mode.
        if (server) {
            const peers = topics.get(topicId) ?? new Map();
            peers.set(peerId, { makeConnection: _incoming });
            topics.set(topicId, peers);
            publishedTopics.add(topicId);
        } else {
            // If previously published and now called with server=false, unpublish.
            unpublish(topicId);
        }

        const discovery = {
            leave: () => leave(topic),
            destroy: () => leave(topic),
            refresh: () => Promise.resolve(),
            flushed: () => Promise.resolve()
        };

        return discovery;
    }

    function leave(topic) {
        if (closing || closed) return;

        const topicId = idEncoding.encode(topic);
        joinedTopics.delete(topicId);
        dialTopics.delete(topicId);
        unpublish(topicId);
    }

    function unpublish(topicId) {
        publishedTopics.delete(topicId);
        const peers = topics.get(topicId);
        if (!peers) return;
        peers.delete(peerId);
        if (peers.size === 0) topics.delete(topicId);
    }

    function on(event, cb) {
        emitter.on(event, cb);

        // Backfill only for the first "connection" listener.
        if (event === "connection" && !didBackfillConnections) {
            didBackfillConnections = true;
            for (const { socket, peerInfo } of connections.values()) {
                emitter.emit("connection", socket, peerInfo);
            }
        }
    }

    function off(event, cb) {
        emitter.off(event, cb);
    }

    function retainStale(peer, socket) {
        if (!reconnectRace.enabled) return;
        const timer = setTimeout(async () => {
            retentionTimers.delete(timer);
            await destroySocket(socket);
            const arr = staleSockets.get(peer);
            if (arr) {
                staleSockets.set(peer, arr.filter((s) => s !== socket));
                if (staleSockets.get(peer).length === 0) staleSockets.delete(peer);
            }
        }, reconnectRace.staleRetentionMs);
        retentionTimers.add(timer);
        const arr = staleSockets.get(peer) ?? [];
        arr.push(socket);
        staleSockets.set(peer, arr);
    }

    function scheduleReconnectTick() {
        if (!reconnectRace.enabled) return;
        const timer = setTimeout(() => {
            reconnectTimers.delete(timer);
            if (!closing && !closed) tick();
        }, reconnectRace.reconnectDelayMs);
        reconnectTimers.add(timer);
    }

    function trackConnection(peer, socket) {
        const drop = () => {
            const current = connections.get(peer)?.socket;
            if (current === socket) {
                connections.delete(peer);
                emitter.emit("update");
                retainStale(peer, socket);
                scheduleReconnectTick();
            } else if (reconnectRace.enabled) {
                // stale socket closed after new one took over
                retainStale(peer, socket);
            }
        };
        socket.once("close", drop);
        socket.once("error", drop);
    }

    async function _incoming(conn) {
        if (closing || closed) return;
        if (!conn || !conn.id) return;
        if (conn.id === peerId) return;
        if (connections.has(conn.id)) {
            if (!reconnectRace.duplicateConnection) return;
            // allow duplicate event later; still accept for overlap
        }

        // Guard: if we're already in-flight dialing this peer, don't also accept/construct.
        // (This is conservative; the dial-election below in loop() is the main duplication killer.)
        if (connecting.has(conn.id)) return;

        const ssLocal = new NoiseStream(false); // incoming side: non-initiator
        const ssRemote = new NoiseStream(true); // remote side: initiator (returned to caller)

        ssLocal.rawStream.pipe(ssRemote.rawStream).pipe(ssLocal.rawStream);

        const remotePublicKey = conn.publicKey ?? idEncoding.decode(conn.id);

        const peerInfo = {
            id: conn.id,
            publicKey: remotePublicKey,
            initiator: false
        };

        connections.set(conn.id, { socket: ssLocal, peerInfo });
        trackConnection(conn.id, ssLocal);
        emitter.emit("update");

        ssLocal.once("open", () => {
            if (closing || closed) return;
            ssLocal.remotePublicKey = remotePublicKey;
            emitter.emit("connection", ssLocal, peerInfo);
        });

        return ssRemote;
    }

    function shouldDial(remotePeerId) {
        // Deterministic dial election: only one side initiates.
        // If both sides run the same code, this prevents double-connect.
        return peerId < remotePeerId;
    }

    async function dial(remotePeerId, makeConnection) {
        if (closing || closed) return;
        if (remotePeerId === peerId) return;
        if (connections.has(remotePeerId) && !reconnectRace.duplicateConnection) return;

        if (!shouldDial(remotePeerId)) return;
        if (connecting.has(remotePeerId)) return;

        const p = (async () => {
            const socket = await makeConnection({
                id: peerId,
                publicKey: keyPair.publicKey
            });

            if (closing || closed) {
                if (socket?.destroy) await destroySocket(socket);
                return;
            }
            if (!socket) return;

            // It's possible we raced and connected through the other side while awaiting.
            if (connections.has(remotePeerId) && !reconnectRace.duplicateConnection) {
                if (socket?.destroy) await destroySocket(socket);
                return;
            }

            const remotePublicKey = idEncoding.decode(remotePeerId);

            const peerInfo = {
                id: remotePeerId,
                publicKey: remotePublicKey,
                initiator: true
            };

            connections.set(remotePeerId, { socket, peerInfo });
            trackConnection(remotePeerId, socket);
            emitter.emit("update");

            socket.once("open", () => {
                if (closing || closed) return;
                socket.remotePublicKey = remotePublicKey;
                emitter.emit("connection", socket, peerInfo);
            });
        })().finally(() => {
            connecting.delete(remotePeerId);
        });

        connecting.set(remotePeerId, p);
        await p;
    }

    let tickTimer;

    function tick() {
        if (closing || closed) return;

        for (const [topicId, peers] of topics.entries()) {
            if (!dialTopics.has(topicId)) continue;

            for (const [remotePeerId, { makeConnection }] of peers.entries()) {
                if (remotePeerId === peerId) continue;              // FIX: continue, not return
                if (connections.has(remotePeerId)) continue;        // FIX: continue, not return
                if (closing || closed) return;

                // Fire and forget; connection is guarded by connecting map
                // (but still awaits inside dial for sequencing correctness).
                void dial(remotePeerId, makeConnection);
            }
        }

        if (closing || closed) return;
        tickTimer = setTimeout(tick, 10);
    }

    async function flush(timeoutMs = 100) {
        if (closing || closed) return;

        const start = Date.now();
        let stableZero = 0;

        while (!closed && !closing) {
            // Wait for any in-flight dial promises.
            await Promise.allSettled(Array.from(connecting.values()));

            if (connecting.size === 0 && retentionTimers.size === 0 && reconnectTimers.size === 0) {
                stableZero += 1;
                if (stableZero >= 2) return; // two consecutive quiet checks
            } else {
                stableZero = 0;
            }

            if (Date.now() - start >= timeoutMs) return;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
    }

    async function destroySocket(s) {
        if (!s) return;
        await new Promise((resolve) => {
            const done = () => resolve();

            try {
                if (s.destroyed) return resolve();
                s.once?.("close", done);
                s.once?.("error", done);
                if (typeof s.destroy === "function") s.destroy();
                else setImmediate(done);
                // Fallback in case no events fire.
                setTimeout(done, 10);
            } catch {
                resolve();
            }
        });
    }

    tick();

    return {
        async close() {
            if (closed || closing) return;
            closing = true;

            if (tickTimer) clearTimeout(tickTimer);
            for (const t of Array.from(retentionTimers)) clearTimeout(t);
            for (const t of Array.from(reconnectTimers)) clearTimeout(t);
            retentionTimers.clear();
            reconnectTimers.clear();

            // Stop publishing our topics (prevents new dials toward us)
            for (const topicId of Array.from(publishedTopics)) {
                unpublish(topicId);
            }
            publishedTopics.clear();
            dialTopics.clear();
            joinedTopics.clear();

            // Wait for in-flight connects to settle (best-effort)
            await Promise.allSettled(Array.from(connecting.values()));

            // Destroy sockets best-effort.
            await Promise.allSettled(
                Array.from(connections.values()).map(({ socket }) => destroySocket(socket))
            );
            await Promise.allSettled(
                Array.from(staleSockets.values()).flat().map((socket) => destroySocket(socket))
            );
            staleSockets.clear();

            connections.clear();
            emitter.emit("update");
            closed = true;
            emitter.emit("close");
        },

        // Alias used by some labs; accepts options for API parity but ignores them.
        async destroy(_opts = {}) {
            await this.close();
        },

        connections,       // Map(remotePeerId -> { socket, peerInfo })
        join,
        leave,
        flush,
        topics: joinedTopics,
        on,
        off,
        keyPair,
        id: peerId
    };
}

export { createFakeSwarm }
export default createFakeSwarm;
