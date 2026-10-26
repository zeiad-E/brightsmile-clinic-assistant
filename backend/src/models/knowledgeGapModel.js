import { normalizeText } from '../utils/text.js';
import { unwrap } from './query.js';

/**
 * Questions the assistant couldn't answer from the knowledge base. The same question asked
 * again bumps its count, so the owner sees what patients ask most and what to add.
 */
export async function record(db, { question, language = 'en', conversationId = null }) {
  const normalized = normalizeText(question).slice(0, 300);
  if (!normalized) return;
  const existing = await unwrap(
    db.from('knowledge_gaps').select('id, count, status').eq('normalized', normalized).eq('language', language).maybeSingle(),
  );
  if (existing) {
    await unwrap(
      db
        .from('knowledge_gaps')
        .update({
          count: existing.count + 1,
          last_seen_at: new Date().toISOString(),
          last_conversation_id: conversationId,
          status: existing.status === 'ignored' ? 'ignored' : 'open',
        })
        .eq('id', existing.id),
    );
    return;
  }
  await unwrap(
    db.from('knowledge_gaps').insert({
      question: String(question).slice(0, 500),
      normalized,
      language,
      last_conversation_id: conversationId,
    }),
  );
}
