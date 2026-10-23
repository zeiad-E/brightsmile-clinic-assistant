/**
 * Embed knowledge docs that are pending (or failed) and run a quick search check.
 *
 * Usage:
 *   npm run ingest            # pending/failed typed-in docs
 *   npm run ingest -- --all   # re-embed every typed-in doc
 */
import { supabase } from '../src/db/supabase.js';
import { ingestDoc } from '../src/rag/ingest.js';
import { retrieve } from '../src/rag/retrieve.js';

if (!supabase) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env first.');
  process.exit(1);
}

const all = process.argv.includes('--all');
let query = supabase.from('knowledge_docs').select('id, title, language, content').eq('source_type', 'manual');
if (!all) query = query.in('ingest_status', ['pending', 'failed']);
const { data: docs, error } = await query.order('group_key');
if (error) throw error;

console.log(`Embedding ${docs.length} doc(s)…`);
let failed = 0;
for (const doc of docs) {
  const result = await ingestDoc(doc);
  if (!result.ok) failed += 1;
  console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} [${doc.language}] ${doc.title}${result.ok ? ` (${result.chunks} chunks)` : ` — ${result.error}`}`);
}

console.log('\nSearch check:');
const checks = [
  ['How much is a teeth cleaning?', 'en'],
  ['كم سعر تنظيف الأسنان؟', 'ar'],
  ['Are you open on Friday?', 'en'],
  ['هل تقبلون التأمين؟', 'ar'],
  ['What is the capital of France?', 'en'],
];
for (const [question, language] of checks) {
  const hits = await retrieve(question, { topK: 2, language });
  const summary = hits.length
    ? hits.map((h) => `${h.source} (${h.language}, ${h.similarity.toFixed(3)})`).join(' | ')
    : '— no match (correct for off-topic questions)';
  console.log(`  "${question}" → ${summary}`);
}

process.exit(failed ? 1 : 0);
