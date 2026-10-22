import { supabase } from '../db/supabase.js';
import { embedMany } from './embed.js';

/**
 * Ingest knowledge docs into pgvector.
 * TODO: wire to a seed of clinic docs (services, pricing, hours, policies...) in EN + AR.
 *
 * Steps:
 *  1. chunk each doc,
 *  2. embed chunks,
 *  3. upsert into knowledge_chunks with source_ref for citations.
 */
export async function ingestDoc({ docId, title, content, category }) {
  const chunks = chunkText(content);
  const embeddings = await embedMany(chunks);

  if (!supabase) return { ok: false, reason: 'no_db' };

  const rows = chunks.map((text, i) => ({
    doc_id: docId,
    chunk_text: text,
    embedding: embeddings[i],
    source_ref: `${title}#${i + 1}`,
    category,
  }));

  const { error } = await supabase.from('knowledge_chunks').insert(rows);
  return { ok: !error, inserted: rows.length };
}

function chunkText(text, size = 800, overlap = 100) {
  const chunks = [];
  for (let i = 0; i < text.length; i += size - overlap) {
    chunks.push(text.slice(i, i + size));
  }
  return chunks;
}
