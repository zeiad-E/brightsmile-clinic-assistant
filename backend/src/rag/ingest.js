import { supabase } from '../db/supabase.js';
import { embedMany } from './embed.js';
import { chunkText } from './chunk.js';
import { logger } from '../utils/logger.js';

/**
 * Turn one knowledge doc into searchable chunks:
 * split → embed (title + chunk, so each piece keeps its context) → replace the doc's
 * chunks → mark the doc ready. On failure the doc is marked failed with the reason.
 */
export async function ingestDoc(doc) {
  if (!supabase) throw new Error('Supabase is not configured');

  await supabase.from('knowledge_docs').update({ ingest_status: 'processing', ingest_error: null }).eq('id', doc.id);

  try {
    const chunks = chunkText(doc.content);
    if (chunks.length === 0) throw new Error('document has no text');

    const embeddings = await embedMany(chunks.map((chunk) => `${doc.title}\n${chunk}`));

    const { error: deleteError } = await supabase.from('knowledge_chunks').delete().eq('doc_id', doc.id);
    if (deleteError) throw deleteError;

    const rows = chunks.map((content, index) => ({
      doc_id: doc.id,
      chunk_index: index,
      content,
      embedding: JSON.stringify(embeddings[index]),
    }));
    const { error: insertError } = await supabase.from('knowledge_chunks').insert(rows);
    if (insertError) throw insertError;

    const { error: readyError } = await supabase
      .from('knowledge_docs')
      .update({ ingest_status: 'ready', ingest_error: null })
      .eq('id', doc.id);
    if (readyError) throw readyError;

    return { ok: true, chunks: rows.length };
  } catch (err) {
    logger.error(`Ingest failed for doc ${doc.id}: ${err.message}`);
    await supabase
      .from('knowledge_docs')
      .update({ ingest_status: 'failed', ingest_error: String(err.message).slice(0, 500) })
      .eq('id', doc.id);
    return { ok: false, error: err.message };
  }
}
