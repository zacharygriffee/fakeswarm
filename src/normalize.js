export function normalizeArgs(seedOrOpts, topicsArg) {
  const isBufferLike =
    seedOrOpts &&
    (Buffer.isBuffer(seedOrOpts) ||
      seedOrOpts instanceof Uint8Array);

  if (isBufferLike || seedOrOpts === null || seedOrOpts === undefined) {
    return { seed: seedOrOpts, net: undefined, topics: topicsArg };
  }

  if (typeof seedOrOpts === "object") {
    const { seed = undefined, net = undefined } = seedOrOpts;
    return { seed, net, topics: topicsArg };
  }

  return { seed: undefined, net: undefined, topics: topicsArg };
}
