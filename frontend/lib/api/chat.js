import { ApiError, http } from './client.js';

/**
 * Sends one chat message and reads the answer as a stream of events (Server-Sent Events over a POST).
 *
 * axios normally waits for the whole response. Here we ask its fetch adapter for the raw stream
 * (`adapter: 'fetch'`, `responseType: 'stream'`), so each event is handled the moment it arrives
 * and the reply types out live. No time limit: a busy assistant can take a while to answer.
 *
 * handlers: onConversation(id) · onStatus({ text, stage, position }) · onCard(card) ·
 *           onToken(text) · onDone(result) · onError({ status, error, message })
 */
export async function streamChat({ message, conversationId, token, language, signal }, handlers = {}) {
  let stream;
  try {
    const response = await http.post(
      '/chat/stream',
      { message, conversation_id: conversationId ?? undefined, language },
      {
        adapter: 'fetch',
        responseType: 'stream',
        timeout: 0,
        signal,
        headers: { Accept: 'text/event-stream', ...(token && { Authorization: `Bearer ${token}` }) },
      },
    );
    stream = response.data;
  } catch (err) {
    // Errors before the stream opens (validation, rate limit, sign-in) arrive as ApiError.
    if (err instanceof ApiError) handlers.onError?.({ status: err.status, error: err.code, message: err.message });
    else if (err?.name !== 'CanceledError') handlers.onError?.({ status: 0, error: 'network_error', message: 'Could not reach the clinic assistant.' });
    return;
  }

  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
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
