'use client';

import { useId, useState } from 'react';
import { intlLocale } from '@/i18n/config';
import { COUNTRIES, joinPhone, phoneProblem, splitPhone } from '@/lib/phone';
import styles from './DetailsForm.module.css';

/**
 * The details form the assistant shows in the chat (backend agent/detailsForm.js), instead of
 * asking for name, birth date, phone and email one message at a time.
 *
 * - It opens filled in with what the patient already told the assistant (card.values).
 * - Every field is checked while typing, with the same rules as the server, and says what is wrong
 *   in plain words ("this one has 12 digits"). A filled-in value with a problem shows it at once.
 * - Phone: a country-code picker (Egypt first) + the number as people write it ("010…").
 *   Birth date: day / month / year pickers, so there is no date format to get wrong.
 * - "Continue" sends the values to the server with the chat message (Chat.js → onSubmit). The
 *   server checks them again; a field it refuses comes back here (fieldErrors).
 *
 * Only the latest card is `active`: an older form stays on screen, greyed out.
 */

const today = () => new Date().toISOString().slice(0, 10);

/** '1990-03-15' → { d: '15', m: '3', y: '1990' } (empty pickers for anything else). */
function splitDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  return m ? { y: m[1], m: String(Number(m[2])), d: String(Number(m[3])) } : { d: '', m: '', y: '' };
}
const joinDate = ({ d, m, y }) => (d && m && y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '');

function dateProblem(parts) {
  const value = joinDate(parts);
  if (!value) return { key: 'dobMissing' };
  const date = new Date(`${value}T00:00:00Z`);
  if (date.getUTCDate() !== Number(parts.d)) return { key: 'dobInvalid' }; // 31 February
  if (value > today()) return { key: 'dobFuture' };
  return null;
}
const nameProblem = (name) => (!name ? { key: 'nameMissing' } : name.split(' ').length < 2 ? { key: 'nameShort' } : null);
const emailProblem = (email, optional) =>
  !email ? (optional ? null : { key: 'emailMissing' }) : /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? null : { key: 'emailInvalid' };

export default function DetailsForm({ card, t, locale, active, when, className = '', onSubmit }) {
  const f = t.form;
  const id = useId();
  const keys = card.fields.map((field) => field.key);
  const optional = new Set(card.fields.filter((field) => field.optional).map((field) => field.key));

  const [name, setName] = useState(card.values?.full_name ?? '');
  const [email, setEmail] = useState(card.values?.email ?? '');
  const [phone, setPhone] = useState(() => splitPhone(card.values?.phone));
  const [dob, setDob] = useState(() => splitDate(card.values?.date_of_birth));
  // A field shows its check once the patient has left it (or it came filled in, or they pressed Continue).
  const [touched, setTouched] = useState(() => new Set(Object.keys(card.values ?? {})));
  const [serverErrors, setServerErrors] = useState({});
  const [state, setState] = useState('idle'); // idle | sending | sent

  const values = {
    full_name: name.trim().replace(/\s+/g, ' '),
    date_of_birth: joinDate(dob),
    phone: joinPhone(phone.dial, phone.local),
    email: email.trim(),
  };
  const problems = {
    full_name: nameProblem(values.full_name),
    date_of_birth: dateProblem(dob),
    phone: phoneProblem(values.phone),
    email: emailProblem(values.email, optional.has('email')),
  };
  const ready = keys.every((key) => !problems[key]);
  const locked = !active || state !== 'idle';

  const touch = (key) => setTouched((all) => (all.has(key) ? all : new Set([...all, key])));
  const edit = (key, apply) => {
    setServerErrors(({ [key]: _gone, ...rest }) => rest);
    apply();
  };
  const messageFor = (key) => {
    if (!touched.has(key)) return null;
    if (serverErrors[key] && !problems[key]) return serverErrors[key];
    const problem = problems[key];
    return problem ? f.errors[problem.key].replace('{n}', Number(problem.n ?? 0).toLocaleString(intlLocale(locale))) : null;
  };
  const stateOf = (key) => (!touched.has(key) ? '' : messageFor(key) ? styles.bad : values[key] ? styles.good : '');

  async function submit(event) {
    event.preventDefault();
    setTouched(new Set(keys));
    if (!ready || locked) return;
    setState('sending');
    const result = await onSubmit({ purpose: card.purpose, ...Object.fromEntries(keys.map((key) => [key, values[key]])) });
    if (result?.ok) return setState('sent');
    setServerErrors(result?.fieldErrors ?? {});
    setState('idle');
  }

  const months = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(intlLocale(locale), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1))));
  const thisYear = new Date().getFullYear();
  const country = COUNTRIES.find((c) => c.dial === phone.dial) ?? COUNTRIES[0];
  const hint = (key) => {
    const message = messageFor(key);
    return message ? (
      <p id={`${id}-${key}-hint`} className={styles.problem} role="alert">
        {message}
      </p>
    ) : null;
  };

  const field = {
    full_name: (
      <div key="full_name" className={`${styles.field} ${stateOf('full_name')}`}>
        <label htmlFor={`${id}-name`}>{f.fullName}</label>
        <div className={styles.control}>
          <input
            id={`${id}-name`}
            value={name}
            onChange={(e) => edit('full_name', () => setName(e.target.value))}
            onBlur={() => touch('full_name')}
            placeholder={f.namePlaceholder}
            autoComplete="name"
            dir="auto"
            maxLength={120}
            aria-invalid={Boolean(messageFor('full_name'))}
            aria-describedby={`${id}-full_name-hint`}
          />
          <Tick />
        </div>
        {hint('full_name')}
      </div>
    ),
    date_of_birth: (
      <fieldset key="date_of_birth" className={`${styles.field} ${stateOf('date_of_birth')}`} aria-describedby={`${id}-date_of_birth-hint`}>
        <legend>{f.dob}</legend>
        <div className={styles.dob}>
          {[
            ['d', f.day, Array.from({ length: 31 }, (_, i) => [String(i + 1), (i + 1).toLocaleString(intlLocale(locale))])],
            ['m', f.month, months.map((label, i) => [String(i + 1), label])],
            ['y', f.year, Array.from({ length: thisYear - 1899 }, (_, i) => [String(thisYear - i), String(thisYear - i)])],
          ].map(([part, label, options]) => (
            <select
              key={part}
              aria-label={label}
              value={dob[part]}
              onChange={(e) => edit('date_of_birth', () => setDob((d) => ({ ...d, [part]: e.target.value })))}
              onBlur={() => touch('date_of_birth')}
              className={dob[part] ? '' : styles.empty}
            >
              <option value="">{label}</option>
              {options.map(([value, text]) => (
                <option key={value} value={value}>
                  {text}
                </option>
              ))}
            </select>
          ))}
        </div>
        {hint('date_of_birth')}
      </fieldset>
    ),
    phone: (
      <div key="phone" className={`${styles.field} ${stateOf('phone')}`}>
        <label htmlFor={`${id}-phone`}>{f.phone}</label>
        <div className={styles.phone} dir="ltr">
          {/* The native picker stays (keyboard, screen readers, phone wheels); only "+20 ▾" is drawn on top. */}
          <span className={styles.country}>
            <span aria-hidden="true">+{country.dial}</span>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 10l5 5 5-5" />
            </svg>
            <select aria-label={f.country} value={phone.dial} onChange={(e) => edit('phone', () => setPhone((p) => ({ ...p, dial: e.target.value })))}>
              {COUNTRIES.map((c) => (
                <option key={c.dial} value={c.dial}>
                  {(locale === 'ar' ? c.ar : c.en) + ` (+${c.dial})`}
                </option>
              ))}
            </select>
          </span>
          <div className={styles.control}>
            <input
              id={`${id}-phone`}
              value={phone.local}
              onChange={(e) => edit('phone', () => setPhone((p) => ({ ...p, local: e.target.value })))}
              onBlur={() => touch('phone')}
              placeholder={phone.dial === '20' ? f.phonePlaceholder : ''}
              type="tel"
              inputMode="tel"
              autoComplete="tel-national"
              maxLength={24}
              aria-invalid={Boolean(messageFor('phone'))}
              aria-describedby={`${id}-phone-hint`}
            />
            <Tick />
          </div>
        </div>
        {hint('phone')}
      </div>
    ),
    email: (
      <div key="email" className={`${styles.field} ${stateOf('email')}`}>
        <label htmlFor={`${id}-email`}>
          {f.email}
          {optional.has('email') && <span className={styles.optional}>{f.optional}</span>}
        </label>
        <div className={styles.control}>
          <input
            id={`${id}-email`}
            value={email}
            onChange={(e) => edit('email', () => setEmail(e.target.value))}
            onBlur={() => touch('email')}
            placeholder={f.emailPlaceholder}
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            maxLength={254}
            aria-invalid={Boolean(messageFor('email'))}
            aria-describedby={`${id}-email-hint`}
          />
          <Tick />
        </div>
        {optional.has('email') && !messageFor('email') && <p className={styles.why}>{f.emailWhy}</p>}
        {hint('email')}
      </div>
    ),
  };

  return (
    <form className={`${className} ${styles.form}`} onSubmit={submit} noValidate>
      <div className={styles.head}>
        <span className={styles.badge} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M8 4h8a2 2 0 0 1 2 2v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6a2 2 0 0 1 2-2Z" />
            <path d="M9 9h6M9 13h6M9 17h3" />
          </svg>
        </span>
        <div>
          <p className={styles.title}>{f.title[card.purpose]}</p>
          <p className={styles.lead}>{f.lead[card.purpose]}</p>
        </div>
      </div>

      {card.booking && (
        <p className={styles.booking}>
          <strong>{(locale === 'ar' && card.booking.service_ar) || card.booking.service}</strong>
          <span>{(locale === 'ar' && card.booking.doctor_ar) || card.booking.doctor}</span>
          {when && <span>{when}</span>}
        </p>
      )}
      {card.notice === 'not_matched' && <p className={styles.notice}>{f.notMatched}</p>}

      <fieldset className={styles.fields} disabled={locked}>
        {keys.map((key) => field[key])}
      </fieldset>

      <p className={styles.private}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="5" y="11" width="14" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
        {f.private}
      </p>

      <button type="submit" className={`${styles.submit} ${state === 'sent' ? styles.sent : ''}`} disabled={locked} aria-disabled={!ready}>
        {state === 'sent' ? (
          <>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            {f.sent}
          </>
        ) : state === 'sending' ? (
          f.sending
        ) : (
          f.submit[card.purpose]
        )}
      </button>
    </form>
  );
}

function Tick() {
  return (
    <svg className={styles.tick} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
