/**
 * Server-Sent Events (SSE): one HTTP response that stays open and carries a series of small
 * messages, each `event: <type>` + `data: <json>`. The browser reads them as they arrive.
 *
 * Analogy: instead of one letter when everything is done, a few text messages along the way
 * ("you're 2nd in line", "checking free times…", then the answer).
 */
export function openEventStream(req, res, { heartbeatMs = 15_000 } = {}) {
  let closed = false;
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // ask proxies not to hold messages back
  });
  res.flushHeaders();

  // A comment line every 15 s keeps proxies (Cloudflare, Render) from closing a quiet stream.
  const heartbeat = setInterval(() => write(': ping\n\n'), heartbeatMs);
  heartbeat.unref?.();

  // The visitor closed the tab: stop writing. The turn itself still finishes and is saved,
  // so a booking is never left half-done.
  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });

  function write(chunk) {
    if (!closed && !res.writableEnded) res.write(chunk);
  }

  const send = (type, data) => write(`event: ${type}\ndata: ${JSON.stringify(data ?? {})}\n\n`);

  return {
    send,
    get closed() {
      return closed;
    },
    close() {
      clearInterval(heartbeat);
      if (!res.writableEnded) res.end();
    },
  };
}

/** Splits a reply into small pieces (a few words each) that keep their spaces and line breaks. */
export function replyChunks(text, wordsPerChunk = 3) {
  const words = String(text ?? '').match(/\S+\s*|\s+/g) ?? [];
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) chunks.push(words.slice(i, i + wordsPerChunk).join(''));
  return chunks;
}
