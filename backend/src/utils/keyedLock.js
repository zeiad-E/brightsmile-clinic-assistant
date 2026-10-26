/**
 * One-at-a-time per key (e.g. per conversation).
 *
 * If a patient sends two messages quickly, the second waits until the first turn has
 * finished, so both turns never read and write the same conversation state at once.
 * Different keys (different conversations) still run in parallel.
 */
export function createKeyedLock() {
  const tails = new Map();

  return async function withLock(key, task) {
    const previous = tails.get(key) ?? Promise.resolve();
    let release;
    const current = new Promise((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current);
    tails.set(key, tail);

    await previous;
    try {
      return await task();
    } finally {
      release();
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
