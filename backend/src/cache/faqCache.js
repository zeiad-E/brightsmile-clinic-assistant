/**
 * Lightweight FAQ cache for very common questions.
 * Gives near-instant answers and reduces LLM calls (helps free-tier rate limits).
 *
 * TODO: upgrade to a semantic cache (embed the question, match by similarity).
 * For now: simple normalized exact-match lookup, seeded with a few FAQs.
 */
const FAQ = new Map([
  // normalized question -> answer. Keep EN/AR variants.
  // ['what are your opening hours', 'We are open Sat–Thu, 10:00–18:00.'],
]);

function normalize(q) {
  return (q || '').toLowerCase().trim().replace(/[?!.]/g, '').replace(/\s+/g, ' ');
}

export function getCachedAnswer(question) {
  return FAQ.get(normalize(question)) ?? null;
}

export function setCachedAnswer(question, answer) {
  FAQ.set(normalize(question), answer);
}
