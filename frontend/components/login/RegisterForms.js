'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api/client';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import GlassCard from '@/components/fx/GlassCard';
import CodeReveal from '@/components/card/CodeReveal';
import styles from './Login.module.css';

/**
 * Creating an account: the form → the 6-digit code from the email → "here is your personal code".
 * Nothing is created until the code is right. Someone who already has a record lands in it, and
 * keeps the personal code they have, so they go straight to their account.
 */
export default function RegisterForms({ t, locale }) {
  const router = useRouter();
  const { status, signIn } = useSession();
  const [form, setForm] = useState({ full_name: '', date_of_birth: '', phone: '', email: '', code: '' });
  const [sentTo, setSentTo] = useState(null);
  const [personalCode, setPersonalCode] = useState(null);
  const [error, setError] = useState(null); // { text, signIn? }
  const [working, setWorking] = useState(false);

  const field = (name) => ({ value: form[name], onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })) });

  async function sendCode() {
    const { code: _code, ...details } = form;
    await apiRequest('/auth/register/start', { method: 'POST', body: { ...details, preferred_language: locale } });
    setSentTo(form.email);
  }

  async function confirm() {
    const { personal_code: newCode, ...session } = await apiRequest('/auth/register/verify', { method: 'POST', body: { email: sentTo, code: form.code } });
    if (newCode) setPersonalCode(newCode); // before signIn, so the page never flashes "already signed in"
    await signIn(session);
    if (!newCode) router.push(localePath(locale, '/account'));
  }

  async function submit(e) {
    e.preventDefault();
    setWorking(true);
    setError(null);
    try {
      await (sentTo ? confirm() : sendCode());
    } catch (err) {
      if (err.code === 'phone_in_use') {
        setSentTo(null); // the code is used up: they need the form, or to sign in instead
        setError({ text: t.phoneInUse, signIn: true });
      } else setError({ text: err.message });
    } finally {
      setWorking(false);
    }
  }

  if (personalCode) {
    return (
      <GlassCard className={styles.card}>
        <p className={styles.signedIn}>{t.ready}</p>
        <CodeReveal code={personalCode} name={form.full_name} locale={locale} signInTips />
        <div className={styles.row} style={{ marginTop: 18 }}>
          <Link className={styles.link} href={localePath(locale, '/book')}>
            {t.book}
          </Link>
          <Link className={styles.link} href={localePath(locale, '/account')}>
            {t.account}
          </Link>
        </div>
      </GlassCard>
    );
  }

  if (status === 'signed-in') {
    return (
      <GlassCard className={styles.card}>
        <p className={styles.signedIn}>{t.alreadySignedIn}</p>
        <Link className={styles.link} href={localePath(locale, '/account')}>
          {t.account}
        </Link>
      </GlassCard>
    );
  }

  return (
    <GlassCard className={styles.card}>
      <form className={styles.form} onSubmit={submit} key={String(Boolean(sentTo))}>
        {!sentTo ? (
          <>
            <Field label={t.fullName} autoComplete="name" required {...field('full_name')} />
            <Field label={t.dob} type="date" autoComplete="bday" required {...field('date_of_birth')} />
            <Field label={t.phone} hint={t.phoneHint} type="tel" autoComplete="tel" dir="ltr" required {...field('phone')} />
            <Field label={t.email} hint={t.emailHint} type="email" autoComplete="email" dir="ltr" required {...field('email')} />
          </>
        ) : (
          <>
            <p className={styles.info}>{t.codeSent.replace('{email}', sentTo)}</p>
            <Field label={t.code} inputMode="numeric" autoComplete="one-time-code" dir="ltr" required {...field('code')} />
            <button type="button" className={styles.link} onClick={() => setSentTo(null)}>
              {t.changeDetails}
            </button>
          </>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error.text}{' '}
            {error.signIn && (
              <Link className={styles.link} href={localePath(locale, '/login')}>
                {t.signIn}
              </Link>
            )}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={working}>
          {working ? t.working : sentTo ? t.create : t.sendCode}
        </button>
      </form>
    </GlassCard>
  );
}

function Field({ label, hint, ...input }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input {...input} />
      {hint && <small>{hint}</small>}
    </label>
  );
}
