/**
 * Phone numbers for the chat's details form, with the SAME rules as the server
 * (backend/src/validators/common.js: cleanPhone + phoneProblem). The form checks while the patient
 * types; the server checks again when it arrives (never trust the browser alone).
 * If you change a rule here, change it there too.
 */

/** Country codes offered in the form: Egypt first, then the Arab world, then common others. */
export const COUNTRIES = [
  { dial: '20', en: 'Egypt', ar: 'مصر' },
  { dial: '966', en: 'Saudi Arabia', ar: 'السعودية' },
  { dial: '971', en: 'UAE', ar: 'الإمارات' },
  { dial: '965', en: 'Kuwait', ar: 'الكويت' },
  { dial: '974', en: 'Qatar', ar: 'قطر' },
  { dial: '973', en: 'Bahrain', ar: 'البحرين' },
  { dial: '968', en: 'Oman', ar: 'عُمان' },
  { dial: '962', en: 'Jordan', ar: 'الأردن' },
  { dial: '961', en: 'Lebanon', ar: 'لبنان' },
  { dial: '964', en: 'Iraq', ar: 'العراق' },
  { dial: '218', en: 'Libya', ar: 'ليبيا' },
  { dial: '249', en: 'Sudan', ar: 'السودان' },
  { dial: '212', en: 'Morocco', ar: 'المغرب' },
  { dial: '216', en: 'Tunisia', ar: 'تونس' },
  { dial: '44', en: 'United Kingdom', ar: 'بريطانيا' },
  { dial: '1', en: 'USA / Canada', ar: 'أمريكا / كندا' },
  { dial: '49', en: 'Germany', ar: 'ألمانيا' },
  { dial: '33', en: 'France', ar: 'فرنسا' },
];
const LONGEST_FIRST = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length);

/** "٠١٠ ١٢٣" → "010123": Arabic-Indic digits to 0–9, everything that isn't a digit dropped. */
const digitsOf = (text) => String(text ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, '');

/**
 * "+201001234567" → { dial: '20', local: '01001234567' }, to fill the form. An Egyptian number is
 * shown with its 0, the way people write it. Anything else stays as typed, under Egypt.
 */
export function splitPhone(value) {
  const raw = String(value ?? '').trim();
  const country = raw.startsWith('+') && LONGEST_FIRST.find((c) => digitsOf(raw).startsWith(c.dial));
  if (!country) return { dial: '20', local: raw };
  const rest = digitsOf(raw).slice(country.dial.length);
  return { dial: country.dial, local: country.dial === '20' ? `0${rest}` : rest };
}

/**
 * The chosen country code + what was typed → "+201001234567" (empty if nothing was typed).
 * The leading 0 people type is dropped; a whole number typed with its own "+44…" or "0044…" wins
 * over the picker; for Egypt, "201001234567" (20 without the +) is understood too.
 */
export function joinPhone(dial, local) {
  const typed = String(local ?? '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).trim();
  const digits = digitsOf(typed);
  if (!digits) return '';
  if (typed.startsWith('+')) return `+${digits}`;
  if (typed.startsWith('00')) return `+${digits.slice(2)}`;
  if (dial === '20' && /^201\d{9}$/.test(digits)) return `+${digits}`;
  return `+${dial}${digits.replace(/^0/, '')}`;
}

/**
 * What is wrong with a joined phone: { key, n } for the form's message, or null when it is fine.
 * Egypt: a mobile is 01 + 9 digits (010, 011, 012, 015), a landline 0 + 8–9 digits.
 * Other countries: 7–15 digits (we can't know every country's own rules).
 */
export function phoneProblem(phone) {
  if (!phone) return { key: 'phoneMissing' };
  const digits = phone.slice(1);
  if (digits.startsWith('20')) {
    const local = digits.slice(2);
    if (local.startsWith('1')) {
      if (local.length !== 10) return { key: 'phoneEgLength', n: local.length + 1 };
      return /^1[0125]/.test(local) ? null : { key: 'phoneEgStart' };
    }
    return local.length < 8 || local.length > 9 ? { key: 'phoneEgCheck' } : null;
  }
  if (digits.length < 7) return { key: 'phoneShort' };
  if (digits.length > 15) return { key: 'phoneLong' };
  return null;
}
