/**
 * Makes two spellings of a name comparable, for phone + full name + date of birth sign-in:
 * case, extra spaces, Arabic letter variants (أ إ آ ٱ → ا, ى → ي, ة → ه), diacritics and the
 * stretching character ـ all stop mattering. "أحمد  إبراهيم" and "احمد ابراهيم" match.
 *
 * Same rules as the database's `normalize_person_name`, which booking still uses to recognise a
 * returning patient: both must treat a name the same way.
 */
const DIACRITICS_AND_STRETCH = /[ً-ْـ]/g;
const LETTER_VARIANTS = /[أإآٱىة]/g;
const REPLACEMENT = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه' };

export function normalizePersonName(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(DIACRITICS_AND_STRETCH, '')
    .replace(LETTER_VARIANTS, (letter) => REPLACEMENT[letter])
    .replace(/\s+/g, ' ')
    .trim();
}
