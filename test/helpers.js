export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function once(emitter, event, timeoutMs = 100) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      emitter.off?.(event, handler);
      emitter.removeListener?.(event, handler);
    };

    const handler = (...args) => {
      cleanup();
      resolve(args.length === 1 ? args[0] : args);
    };

    // brittle emits use EventEmitter-style .on/.off
    emitter.on?.(event, handler);
  });
}

export async function waitFor(fn, timeoutMs = 100, intervalMs = 5) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (fn()) return true;
    if (Date.now() - start >= timeoutMs) return false;
    await sleep(intervalMs);
  }
}
