import OpenAI from 'openai';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';

/**
 * LlmClient — the ONLY place in the backend that knows the LLM engine exists.
 *
 * Primary: the self-hosted freellmapi engine (OpenAI-compatible /v1, free providers + failover).
 * Fallback: a direct provider (e.g. Groq) if the engine is unreachable or throttled.
 *
 * This anti-corruption layer keeps the engine swappable and the demo resilient.
 */
class LlmClient {
  constructor() {
    this.engine = new OpenAI({
      baseURL: config.llm.engineBaseUrl,
      apiKey: config.llm.engineApiKey || 'engine',
    });

    this.fallback = config.llm.fallbackBaseUrl
      ? new OpenAI({ baseURL: config.llm.fallbackBaseUrl, apiKey: config.llm.fallbackApiKey })
      : null;
  }

  /**
   * Chat completion with optional tool definitions.
   *
   * Walks the configured model chain in order (each model capped by a timeout),
   * so a slow or exhausted model never stalls the conversation. The engine still
   * rotates keys/providers underneath each request. If the whole chain fails
   * (e.g. the engine is down), falls back to the direct provider.
   */
  async chat({ messages, tools, model, temperature = 0.2 }) {
    const base = {
      messages,
      temperature,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    };
    const chain = model ? [model] : config.llm.chatModels;

    let lastError;
    for (const candidate of chain) {
      try {
        return await this.engine.chat.completions.create(
          { ...base, model: candidate },
          { timeout: config.llm.chatTimeoutMs, maxRetries: 0 },
        );
      } catch (err) {
        lastError = err;
        logger.warn(`LLM model ${candidate} failed (${err.message}); trying next in chain`);
      }
    }

    if (!this.fallback) throw lastError;
    logger.warn('LLM engine chain exhausted; using direct fallback provider');
    return this.fallback.chat.completions.create({
      ...base,
      model: config.llm.fallbackModel,
    });
  }

  /**
   * Create embeddings for RAG.
   *
   * Embeddings are pinned to ONE model and dimension: vectors from different
   * models live in different spaces, so a silent switch would corrupt retrieval.
   * There is deliberately no cross-provider fallback here — fail loudly instead.
   * `encoding_format: 'float'` is required: the SDK otherwise requests base64 and
   * mis-decodes the engine's plain float arrays into NaNs.
   */
  async embed(input) {
    const { embeddingModel, embeddingDimensions } = config.llm;
    const res = await this.engine.embeddings.create({
      model: embeddingModel,
      input,
      dimensions: embeddingDimensions,
      encoding_format: 'float',
    });

    if (res.model && res.model !== embeddingModel) {
      throw new Error(`embedding model mismatch: expected ${embeddingModel}, got ${res.model}`);
    }
    const vectors = res.data.map((d) => d.embedding);
    if (vectors.some((v) => v.length !== embeddingDimensions)) {
      throw new Error(`embedding dimension mismatch: expected ${embeddingDimensions}`);
    }
    return vectors;
  }
}

export const llmClient = new LlmClient();
