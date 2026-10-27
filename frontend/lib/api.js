const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

/**
 * Sends one chat message and reads the answer as a stream of events (Server-Sent Events over a
 * POST, read with fetch — the browser's EventSource only supports GET).
 *
 * handlers: onConversation(id) · onStatus({ text, stage, position }) · onCard(card) ·
 *           onToken(text) · onDone(result) · onError({ status, error, message })
 */
export async function streamChat({ message, conversationId, token, language, signal }, handlers = {}) {
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_URL}/api/chat/stream`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message, conversation_id: conversationId ?? undefined, language }),
      signal,
    });
  } catch {
    handlers.onError?.({ status: 0, error: 'network_error', message: 'Could not reach the clinic assistant.' });
    return;
  }

  // Errors before the stream opens (validation, rate limit, sign-in) come back as plain JSON.
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    handlers.onError?.({ status: res.status, error: body.error ?? 'request_failed', message: body.message ?? 'Something went wrong.' });
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let end;
    while ((end = buffer.indexOf('\n\n')) !== -1) {
      dispatch(buffer.slice(0, end), handlers);
      buffer = buffer.slice(end + 2);
    }
  }
}

function dispatch(block, handlers) {
  if (!block.startsWith('event:')) return; // ": ping" keep-alive lines
  const type = /^event: (.+)$/m.exec(block)?.[1];
  const raw = /^data: (.*)$/m.exec(block)?.[1];
  let data = {};
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    return;
  }
  const handler = {
    conversation: () => handlers.onConversation?.(data.conversation_id),
    status: () => handlers.onStatus?.(data),
    card: () => handlers.onCard?.(data),
    token: () => handlers.onToken?.(data.text),
    done: () => handlers.onDone?.(data),
    error: () => handlers.onError?.(data),
  }[type];
  handler?.();
}
