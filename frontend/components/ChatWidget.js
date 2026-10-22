'use client';

import { useState } from 'react';
import { sendChat } from '../lib/api.js';

/**
 * Minimal chat widget. TODO: streaming, language toggle (EN/AR + RTL),
 * booking-confirmation cards, nicer styling.
 */
export default function ChatWidget() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const next = [...messages, { role: 'user', content: input }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await sendChat(next);
      setMessages([...next, { role: 'assistant', content: res.reply }]);
    } catch {
      setMessages([...next, { role: 'assistant', content: 'Something went wrong. Please try again.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 12, padding: 16, marginTop: 24 }}>
      <div style={{ minHeight: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i}><strong>{m.role === 'user' ? 'You' : 'BrightSmile'}:</strong> {m.content}</div>
        ))}
        {loading && <div>…</div>}
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question or book an appointment…"
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit" disabled={loading}>Send</button>
      </form>
    </div>
  );
}
