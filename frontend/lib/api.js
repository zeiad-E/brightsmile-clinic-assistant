const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

export async function sendChat(messages, context = {}) {
  const res = await fetch(`${API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context }),
  });
  if (!res.ok) throw new Error(`chat failed: ${res.status}`);
  return res.json();
}
