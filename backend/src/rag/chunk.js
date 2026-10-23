/**
 * Split a document into retrieval chunks.
 *
 * Keeps paragraphs/lines together and packs them up to `maxChars`; a paragraph that is
 * too long on its own is split at sentence boundaries. Works for English and Arabic.
 */
export function chunkText(text, { maxChars = 700 } = {}) {
  const paragraphs = String(text ?? '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => (p.length <= maxChars ? [p] : splitSentences(p, maxChars)));

  const chunks = [];
  let current = '';
  for (const paragraph of paragraphs) {
    if (current && current.length + 1 + paragraph.length > maxChars) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = current ? `${current}\n${paragraph}` : paragraph;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitSentences(paragraph, maxChars) {
  const sentences = paragraph.match(/[^.!?؟]+[.!?؟]*\s*/g) ?? [paragraph];
  const parts = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length > maxChars) {
      parts.push(current.trim());
      current = '';
    }
    current += sentence;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}
