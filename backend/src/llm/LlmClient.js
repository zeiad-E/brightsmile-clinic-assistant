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
   * Tries the engine first; on failure, falls back to the direct provider.
   */
  async chat({ messages, tools, model, temperature = 0.2 }) {
    const payload = {
      model: model || config.llm.defaultModel,
      messages,
      temperature,
      ...(tools ? { tools, tool_choice: 'auto' } : {}),
    };

    try {
      return await this.engine.chat.completions.create(payload);
    } catch (err) {
      logger.warn(`LLM engine failed (${err.message}); trying fallback`);
      if (!this.fallback) throw err;
      return await this.fallback.chat.completions.create({
        ...payload,
        model: config.llm.fallbackModel || payload.model,
      });
    }
  }

  /** Create embeddings for RAG. */
  async embed(input) {
    try {
      const res = await this.engine.embeddings.create({
        model: config.llm.embeddingModel,
        input,
      });
      return res.data.map((d) => d.embedding);
    } catch (err) {
      logger.warn(`Embedding via engine failed (${err.message}); trying fallback`);
      if (!this.fallback) throw err;
      const res = await this.fallback.embeddings.create({
        model: config.llm.embeddingModel,
        input,
      });
      return res.data.map((d) => d.embedding);
    }
  }
}

export const llmClient = new LlmClient();
