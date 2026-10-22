import { llmClient } from '../llm/LlmClient.js';

/** Embed a batch of texts (via the LLM engine / fallback). */
export async function embedMany(texts) {
  return llmClient.embed(texts);
}

/** Embed a single text, returns one vector. */
export async function embedOne(text) {
  const [vec] = await llmClient.embed([text]);
  return vec;
}
