/**
 * Privacy masking: the AI never sees contact details, birth dates or sign-in codes.
 *
 * Before a message reaches the AI, those values are swapped for placeholders like
 * [PHONE_1], [EMAIL_1], [DOB_1], [CODE_1]. When the AI calls a tool with a placeholder,
 * the code swaps the real value back in. The AI can still book and sign people in —
 * it just handles labels instead of the real data.
 *
 * Codes are one-time secrets: they are used within the turn and then forgotten
 * (stored history keeps only "[CODE_1]").
 */

const ARABIC_DIGITS = /[٠-٩]/g;
const toLatinDigits = (text) => text.replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));

const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

const PATTERNS = [
  { kind: 'EMAIL', regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // +20 100 123 4567, 0020…, 01001234567
  { kind: 'PHONE', regex: /(?:\+|00)\d[\d\s-]{7,16}\d|\b01\d{9}\b/g },
  // Dates with a year at least 3 years back are birth dates; booking dates (this/next year) stay visible.
  { kind: 'DOB', regex: /\b(?:19|20)\d{2}[-/.](?:0?[1-9]|1[0-2])[-/.](?:0?[1-9]|[12]\d|3[01])\b/g, dob: true },
  { kind: 'DOB', regex: /\b(?:0?[1-9]|[12]\d|3[01])[-/.](?:0?[1-9]|1[0-2])[-/.](?:19|20)\d{2}\b/g, dob: true },
  { kind: 'DOB', regex: new RegExp(`\\b(?:0?[1-9]|[12]\\d|3[01])\\s+(?:${MONTHS})\\.?,?\\s+(?:19|20)\\d{2}\\b`, 'gi'), dob: true },
  { kind: 'DOB', regex: new RegExp(`\\b(?:${MONTHS})\\.?\\s+(?:0?[1-9]|[12]\\d|3[01]),?\\s+(?:19|20)\\d{2}\\b`, 'gi'), dob: true },
  // Personal codes (K7Q4-9M2X, K7Q49M2X, k7q4 9m2x): checked by isPersonalCode, so ordinary
  // word pairs like "Read this" or "make sure" are never mistaken for a code. The lookbehind/
  // lookahead let "code K7Q4 9M2X" be checked at every word start, not just the first match.
  { kind: 'CODE', regex: /(?<![A-Za-z0-9])[A-Za-z0-9]{4}-[A-Za-z0-9]{4}(?![A-Za-z0-9])/g, personalCode: true },
  { kind: 'CODE', regex: /(?<![A-Za-z0-9])[A-Za-z0-9]{8}(?![A-Za-z0-9])/g, personalCode: true },
  // (codes typed with a space, "k7q4 9m2x", are found by maskSpacedCodes below)
  // Email sign-in codes: 6–10 digits on their own.
  { kind: 'CODE', regex: /\b\d{6,10}\b/g },
];

const YEAR = /(19|20)\d{2}/;
const isPastBirthYear = (text, now) => {
  const year = Number(YEAR.exec(text)?.[0]);
  return year && year <= now.getUTCFullYear() - 3;
};

const PLACEHOLDER = /\[(EMAIL|PHONE|DOB|CODE)_(\d+)\]/g;

/**
 * Codes use 31 symbols (no 0/O, 1/I/L). A real code has a digit and a letter — or is typed
 * exactly like a code ("ABCD-EFGH"). Normal words always contain a vowel like I/O or no digit.
 */
const CODE_SYMBOLS = /^[A-HJKMNP-Z2-9]{8}$/;
function isPersonalCode(match) {
  const compact = match.replace(/[-\s]/g, '').toUpperCase();
  if (!CODE_SYMBOLS.test(compact)) return false;
  if (/[2-9]/.test(compact) && /[A-Z]/.test(compact)) return true;
  return /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(match); // all capitals with a dash, exactly as emailed
}

/**
 * Replaces sensitive values in `text`. `map` (placeholder → value) is updated in place
 * and reused across the conversation, so the same phone keeps the same placeholder.
 */
export function maskText(text, map = {}, { now = new Date() } = {}) {
  let masked = toLatinDigits(String(text ?? ''));
  const reverse = new Map(Object.entries(map).map(([key, value]) => [value, key]));
  const counters = {};
  for (const key of Object.keys(map)) {
    const [, kind, n] = /^\[(\w+)_(\d+)\]$/.exec(key) ?? [];
    if (kind) counters[kind] = Math.max(counters[kind] ?? 0, Number(n));
  }

  const assign = (kind, value) => {
    if (reverse.has(value)) return reverse.get(value);
    counters[kind] = (counters[kind] ?? 0) + 1;
    const key = `[${kind}_${counters[kind]}]`;
    map[key] = value;
    reverse.set(value, key);
    return key;
  };

  for (const pattern of PATTERNS) {
    masked = masked.replace(pattern.regex, (match) => {
      if (/^\[(EMAIL|PHONE|DOB|CODE)_\d+\]$/.test(match)) return match;
      if (pattern.dob && !isPastBirthYear(match, now)) return match;
      if (pattern.personalCode && !isPersonalCode(match)) return match;
      return assign(pattern.kind, pattern.kind === 'PHONE' ? match.replace(/[\s-]/g, '') : match.trim());
    });
  }
  return maskSpacedCodes(masked, (value) => assign('CODE', value));
}

/** "my code k7q4 9m2x": checks every pair of neighbouring 4-character words. */
function maskSpacedCodes(text, assign) {
  const words = [...text.matchAll(/[A-Za-z0-9]+/g)];
  let out = '';
  let last = 0;
  for (let i = 0; i < words.length - 1; i += 1) {
    const [a, b] = [words[i], words[i + 1]];
    const pair = `${a[0]} ${b[0]}`;
    if (a[0].length === 4 && b[0].length === 4 && text.slice(a.index + 4, b.index) === ' ' && isPersonalCode(pair)) {
      out += text.slice(last, a.index) + assign(pair);
      last = b.index + 4;
      i += 1;
    }
  }
  return out + text.slice(last);
}

/** Swaps placeholders in tool arguments (any depth) back to the real values. */
export function unmaskValue(value, map) {
  if (typeof value === 'string') return value.replace(PLACEHOLDER, (key) => map[key] ?? key);
  if (Array.isArray(value)) return value.map((item) => unmaskValue(item, map));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unmaskValue(v, map)]));
  }
  return value;
}

/** For what the patient sees: real values back, except codes (never echoed). */
export function restoreForPatient(text, map) {
  return String(text ?? '').replace(PLACEHOLDER, (key, kind) => (kind === 'CODE' ? '••••' : map[key] ?? key));
}

/** What survives the turn: everything except one-time codes. */
export function withoutCodes(map) {
  return Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith('[CODE_')));
}

/** Masks sensitive values inside tool results before the AI reads them. */
export function maskDeep(value, map, options) {
  if (typeof value === 'string') return maskText(value, map, options);
  if (Array.isArray(value)) return value.map((item) => maskDeep(item, map, options));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskDeep(v, map, options)]));
  }
  return value;
}
