'use client';

import { useRef, useState } from 'react';
import { streamChat } from '../lib/api.js';

/**
 * Minimal streaming chat widget: live status ("Checking free times…"), the reply typing out,
 * and the conversation + sign-in kept for the next message.
 * TODO (frontend phase): cards (free times, booking summary), EN/AR toggle + RTL, styling.
 */
export default function ChatWidget() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const conversationId = useRef(null);
  const accessToken = useRef(null); // set when the assistant signs the patient in

  // Appends text to the assistant's reply that is being streamed (the last message).
  const updateLast = (change) =>
    setMessages((all) => [...all.slice(0, -1), { ...all.at(-1), ...change(all.at(-1)) }]);

  async function handleSend(e) {
    e.preventDefault();
    const message = input.trim();
    if (!message || busy) return;
    setMessages((all) => [...all, { role: 'user', content: message }, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    setStatus(null);

    await streamChat(
      { message, conversationId: conversationId.current, token: accessToken.current },
      {
        onConversation: (id) => {
          conversationId.current = id;
        },
        onStatus: (s) => setStatus(s.text),
        onToken: (text) => {
          setStatus(null);
          updateLast((m) => ({ content: m.content + text }));
        },
        onDone: (result) => {
          if (result.session?.access_token) accessToken.current = result.session.access_token;
          updateLast(() => ({ content: result.reply }));
        },
        onError: (err) => updateLast(() => ({ content: err.message || 'Something went wrong. Please try again.', error: true })),
      },
    );

    setStatus(null);
    setBusy(false);
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16, marginTop: 24 }}>
      <div style={{ minHeight: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i} dir="auto" style={{ whiteSpace: 'pre-wrap', color: m.error ? '#b42318' : undefined }}>
            <strong>{m.role === 'user' ? 'You' : 'BrightSmile'}:</strong> {m.content}
          </div>
        ))}
        {status && <div style={{ color: '#666', fontStyle: 'italic' }}>{status}</div>}
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question or book an appointment…"
          maxLength={1000}
          dir="auto"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={busy}>Send</button>
      </form>
    </div>
  );
}
