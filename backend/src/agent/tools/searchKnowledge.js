import { retrieve } from '../../rag/retrieve.js';

/**
 * RAG tool: retrieve relevant clinic knowledge chunks for the query.
 * Returns chunks + source refs so the model can cite (and avoid hallucinating).
 */
export async function searchKnowledge({ query }) {
  const chunks = await retrieve(query, { topK: 4 });
  if (!chunks || chunks.length === 0) {
    return { found: false, message: 'No relevant information in the knowledge base.' };
  }
  return {
    found: true,
    results: chunks.map((c) => ({ text: c.text, source: c.source })),
  };
}
