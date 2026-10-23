import { supabase } from '../db/supabase.js';
import { embedOne } from './embed.js';

/**
 * Retrieve the most relevant knowledge chunks (pgvector cosine similarity), preferring
 * the patient's language. Each result carries the doc title for citations.
 */
export async function retrieve(query, { topK = 4, language = null, minSimilarity = 0.45 } = {}) {
  if (!supabase) return [];

  const embedding = await embedOne(query);
  const { data, error } = await supabase.rpc('match_knowledge_chunks', {
    query_embedding: JSON.stringify(embedding),
    match_count: topK,
    p_language: language,
    min_similarity: minSimilarity,
  });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    text: row.content,
    source: row.title,
    language: row.language,
    similarity: row.similarity,
  }));
}
