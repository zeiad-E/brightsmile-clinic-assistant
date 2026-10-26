/**
 * Loose text matching for what patients type: "cleaning", "Teeth Cleaning", "تنظيف",
 * "dr sarah", "د. سارة" should all find the right service or doctor.
 * Mirrors the database's normalize_person_name (Arabic letter variants, diacritics).
 */
export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[ً-ْـ]/g, '') // Arabic diacritics + tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\b(dr|doctor)\b\.?/g, ' ')
    .replace(/(^|\s)(د\.|دكتوره?|الدكتوره?)(?=\s|$)/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Picks the best match for `query` among items, comparing against several name fields.
 * Exact match beats "contains", which beats shared words. Returns null if nothing fits.
 */
export function bestMatch(items, query, fields) {
  const q = normalizeText(query);
  if (!q) return null;
  const qWords = new Set(q.split(' '));
  let best = null;
  let bestScore = 0;

  for (const item of items) {
    for (const field of fields) {
      const value = normalizeText(item[field]);
      if (!value) continue;
      let score = 0;
      if (value === q) score = 100;
      else if (value.includes(q) || q.includes(value)) score = 60;
      else {
        const shared = value.split(' ').filter((word) => word.length > 2 && qWords.has(word)).length;
        if (shared) score = 20 + shared * 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = item;
      }
    }
  }
  return best;
}
