/**
 * LLM layer smoke test.
 *
 * Verifies the LLM engine end to end: connectivity, plain chat, Arabic replies,
 * tool calling, and embeddings (dimension, model stability, EN↔AR similarity).
 *
 * Usage:
 *   npm run test:llm
 *   LLM_TEST_BASE_URL=https://<space>.hf.space/v1 LLM_TEST_API_KEY=... npm run test:llm
 */
import OpenAI from 'openai';
import { config } from '../src/config/index.js';

const baseURL = process.env.LLM_TEST_BASE_URL || config.llm.engineBaseUrl;
const apiKey = process.env.LLM_TEST_API_KEY || config.llm.engineApiKey;
const chatModel = process.env.LLM_TEST_MODEL || config.llm.defaultModel;
const embeddingModel = process.env.LLM_TEST_EMBEDDING_MODEL || config.llm.embeddingModel;
const embeddingDimensions = config.llm.embeddingDimensions;

if (!apiKey) {
  console.error('Missing API key: set LLM_ENGINE_API_KEY in backend/.env (unified key from the engine dashboard).');
  process.exit(1);
}

const client = new OpenAI({ baseURL, apiKey, timeout: 90_000, maxRetries: 0 });
const results = [];

async function run(name, critical, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, critical, ms: Date.now() - started, detail });
  } catch (err) {
    results.push({ name, ok: false, critical, ms: Date.now() - started, detail: err.message });
  }
}

function routedVia(response) {
  const via = response.headers.get('x-routed-via') ?? 'unknown';
  const attempts = response.headers.get('x-fallback-attempts');
  return attempts ? `${via} (after ${attempts} failover hops)` : via;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Bypass the engine's response cache so every run exercises real providers.
async function chat(messages, extra = {}) {
  return client.chat.completions
    .create({ model: chatModel, messages, temperature: 0, ...extra }, { headers: { 'X-FreeLLM-Cache': 'off' } })
    .withResponse();
}

// 1. Connectivity
await run('connectivity (/v1/models)', true, async () => {
  const models = await client.models.list();
  return `${models.data.length} models/routes listed`;
});

// 2. Plain chat
await run('plain chat', true, async () => {
  const { data, response } = await chat([{ role: 'user', content: 'Reply with exactly the word: pong' }]);
  const text = data.choices[0].message.content?.trim() ?? '';
  if (!/pong/i.test(text)) throw new Error(`unexpected reply: "${text.slice(0, 80)}"`);
  return `via ${routedVia(response)}`;
});

// 3. Arabic reply
await run('arabic reply', true, async () => {
  const { data, response } = await chat([
    { role: 'system', content: "Clinic hours: Saturday–Thursday, 10:00–18:00. Always reply in the user's language." },
    { role: 'user', content: 'مرحبا، ما هي مواعيد عمل العيادة؟' },
  ]);
  const text = data.choices[0].message.content ?? '';
  if (!/[؀-ۿ]/.test(text)) throw new Error(`reply is not Arabic: "${text.slice(0, 80)}"`);
  return `via ${routedVia(response)} → "${text.slice(0, 60).replace(/\s+/g, ' ')}…"`;
});

// 4. Tool calling
await run('tool calling', true, async () => {
  const tools = [{
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Check open appointment slots for a date and service.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date in YYYY-MM-DD format.' },
          service: { type: 'string', description: 'Requested service.' },
        },
        required: ['date'],
      },
    },
  }];
  const { data, response } = await chat(
    [
      { role: 'system', content: 'You are a clinic receptionist. Use tools to check availability before answering.' },
      { role: 'user', content: 'Can I book a teeth cleaning on 2026-11-03?' },
    ],
    { tools, tool_choice: 'auto' },
  );
  const call = data.choices[0].message.tool_calls?.[0];
  if (!call) throw new Error('model answered without calling the tool');
  if (call.function.name !== 'check_availability') throw new Error(`wrong tool: ${call.function.name}`);
  const args = JSON.parse(call.function.arguments || '{}');
  if (!String(args.date ?? '').includes('2026-11-03')) throw new Error(`bad args: ${call.function.arguments}`);
  return `via ${routedVia(response)} → ${call.function.arguments}`;
});

// 5. Embeddings: pinned model, fixed dimension, finite values, EN↔AR semantic match
await run('embeddings (bilingual + stable model)', true, async () => {
  const texts = {
    en: 'How much does a teeth cleaning cost?',
    ar: 'كم سعر تنظيف الأسنان؟',
    unrelated: 'What time does the football match start tonight?',
  };
  const vectors = {};
  const servedBy = new Set();
  for (const [key, input] of Object.entries(texts)) {
    // encoding_format 'float' is required — see LlmClient.embed.
    const res = await client.embeddings.create({
      model: embeddingModel,
      input,
      dimensions: embeddingDimensions,
      encoding_format: 'float',
    });
    vectors[key] = res.data[0].embedding;
    servedBy.add(res.model ?? 'unknown');
  }

  for (const [key, v] of Object.entries(vectors)) {
    if (v.length !== embeddingDimensions) throw new Error(`${key}: dimension ${v.length}, expected ${embeddingDimensions}`);
    if (!v.every(Number.isFinite)) throw new Error(`${key}: vector contains non-finite values`);
  }
  if (servedBy.size !== 1) throw new Error(`embedding model changed between calls: ${[...servedBy].join(' | ')}`);

  const simEnAr = cosine(vectors.en, vectors.ar);
  const simEnUnrelated = cosine(vectors.en, vectors.unrelated);
  if (!Number.isFinite(simEnAr) || !(simEnAr > simEnUnrelated)) {
    throw new Error(`weak cross-lingual match (EN↔AR ${simEnAr} vs EN↔unrelated ${simEnUnrelated})`);
  }
  return `${[...servedBy][0]} · dim ${embeddingDimensions} · EN↔AR ${simEnAr.toFixed(3)} vs unrelated ${simEnUnrelated.toFixed(3)}`;
});

// 6. Production code path: LlmClient.chat walks the model chain with a tool call
await run('LlmClient.chat chain + tools (production)', true, async () => {
  if (process.env.LLM_TEST_BASE_URL) return 'skipped (remote target; LlmClient uses backend/.env)';
  const { llmClient } = await import('../src/llm/LlmClient.js');
  const res = await llmClient.chat({
    messages: [
      { role: 'system', content: 'You are a clinic receptionist. Use tools to check availability before answering.' },
      { role: 'user', content: 'هل يمكنني حجز تنظيف أسنان يوم 2026-11-05؟' },
    ],
    tools: [{
      type: 'function',
      function: {
        name: 'check_availability',
        description: 'Check open appointment slots for a date and service.',
        parameters: { type: 'object', properties: { date: { type: 'string' }, service: { type: 'string' } }, required: ['date'] },
      },
    }],
  });
  const call = res.choices[0].message.tool_calls?.[0];
  if (!call || !JSON.parse(call.function.arguments).date?.includes('2026-11-05')) throw new Error('no valid tool call from chain');
  return `served by ${res.model} → ${call.function.arguments}`;
});

// 7. Production code path: LlmClient.embed (pinning + guards)
await run('LlmClient.embed (production path)', true, async () => {
  if (process.env.LLM_TEST_BASE_URL) return 'skipped (remote target; LlmClient uses backend/.env)';
  const { llmClient } = await import('../src/llm/LlmClient.js');
  const [v] = await llmClient.embed(['Do you accept dental insurance?']);
  if (v.length !== embeddingDimensions || !v.every(Number.isFinite)) throw new Error('invalid vector from LlmClient');
  return `ok · dim ${v.length}`;
});

// Report
console.log(`\nLLM layer test — ${baseURL}  (chat model: ${chatModel}, embedding model: ${embeddingModel})\n`);
for (const r of results) {
  const mark = r.ok ? 'PASS' : r.critical ? 'FAIL' : 'WARN';
  console.log(`  [${mark}] ${r.name.padEnd(38)} ${String(r.ms).padStart(6)} ms  ${r.detail}`);
}
const failed = results.filter((r) => !r.ok && r.critical).length;
console.log(`\n${results.length - failed}/${results.length} passed\n`);
process.exit(failed ? 1 : 0);
