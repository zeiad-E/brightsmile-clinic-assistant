/**
 * Concurrency limiter with a bounded waiting line (a "semaphore").
 *
 * At most `max` assistant turns talk to the AI at the same time — free AI providers limit
 * requests per minute, so sending everything at once would just make them all fail.
 * Extra turns wait in line; if the line is full, or someone has waited too long, they get
 * a polite "busy, try again shortly" instead of the server falling over.
 *
 * Analogy: a clinic waiting room with N doctors. Patients wait their turn; when the room is
 * full, the receptionist asks newcomers to come back a bit later.
 *
 * Kept behind this small interface (run / stats) so it can be swapped for a shared queue
 * (e.g. Redis) when there are several servers.
 */
export class BusyError extends Error {
  constructor(reason) {
    super(`Assistant busy: ${reason}`);
    this.name = 'BusyError';
    this.reason = reason;
  }
}

export function createLimiter({ max, queueMax, maxWaitMs }) {
  let active = 0;
  const waiting = [];

  // Everyone still waiting hears their new place in line (shown to patients while streaming).
  function announcePositions() {
    waiting.forEach((item, index) => item.onQueued?.(index + 1));
  }

  function startNext() {
    let moved = false;
    while (active < max && waiting.length) {
      const item = waiting.shift();
      clearTimeout(item.timer);
      active += 1;
      item.start();
      moved = true;
    }
    if (moved) announcePositions();
  }

  /** `onQueued(position)` is called when the task joins the line and each time it moves up. */
  async function run(task, { onQueued } = {}) {
    if (active < max && waiting.length === 0) {
      active += 1;
    } else {
      if (waiting.length >= queueMax) throw new BusyError('queue_full');
      await new Promise((resolve, reject) => {
        const item = { start: resolve, timer: null, onQueued };
        item.timer = setTimeout(() => {
          const index = waiting.indexOf(item);
          if (index !== -1) waiting.splice(index, 1);
          reject(new BusyError('waited_too_long'));
          announcePositions();
        }, maxWaitMs);
        waiting.push(item);
        onQueued?.(waiting.length);
      });
    }
    try {
      return await task();
    } finally {
      active -= 1;
      startNext();
    }
  }

  return { run, stats: () => ({ active, waiting: waiting.length, max, queueMax }) };
}
