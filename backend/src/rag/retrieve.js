import { supabase } from '../db/supabase.js';
import { embedOne } from './embed.js';

/**
 * Retrieve top-K relevant knowledge chunks via pgvector similarity search.
 * TODO: call a Supabase RPC (e.g. match_knowledge_chunks) with the query embedding.
 */
export async function retrieve(query, { topK = 4 } = {}) {
  if (!supabase) return []; // no DB configured yet

  const embedding = await embedOne(query);
  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: embedding,
    match_count: topK,
  });

  if (error) return [];
  return (data ?? []).map((row) => ({ text: row.chunk_text, source: row.source_ref }));
}
