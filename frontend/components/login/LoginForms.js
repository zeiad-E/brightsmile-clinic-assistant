'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api/client';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import GlassCard from '@/components/fx/GlassCard';
import Magnetic from '@/components/fx/Magnetic';
import styles from './Login.module.css';

// The demo patient from supabase/seed.sql (phone sign-in; not a secret).
const DEMO_PATIENT = { phone: '+201000000001', full_name: 'Mariam Hassan', date_of_birth: '1992-04-15' };
// The read-only team login is only offered when it is configured for this deployment.
const DEMO_VIEWER = process.env.NEXT_PUBLIC_DEMO_VIEWER_EMAIL
  ? { email: process.env.NEXT_PUBLIC_DEMO_VIEWER_EMAIL, password: process.env.NEXT_PUBLIC_DEMO_VIEWER_PASSWORD ?? '' }
  : null;

/**
 * Sign in: patients by email code, by phone + name + date of birth, or by personal code;
 * team members by email + password. Every way ends with a session from the API → signIn().
 */
export default function LoginForms({ t, locale }) {
  const router = useRouter();
  const { status, user, signIn, signOut } = useSession();
  const [tab, setTab] = useState('patient');
  const [method, setMethod] = useState('email');
  const [form, setForm] = useState({ email: '', code: '', phone: '', full_name: '', date_of_birth: '', personal: '', password: '' });
  const [codeSentTo, setCodeSentTo] = useState(null);
  const [message, setMessage] = useState(null); // { kind: 'error' | 'info', text, switchTo?: 'patient' | 'team' }
  const [working, setWorking] = useState(false);

  const field = (name) => ({ value: form[name], onChange: (e) => setForm((f) => ({ ...f, [name]: e.target.value })) });

  /** `role`: which kind of login this form may accept ('patient' on the Patient tab, 'team' on the Team tab). */
  async function run(request, role) {
    setWorking(true);
    setMessage(null);
    try {
      const result = await request();
      if (result?.access_token) {
        // Second lock (the API is the first): the Patient tab never keeps a team login.
        // If one ever comes back, it is signed out again at once and never stored.
        if (role === 'patient' && result.user?.role !== 'patient') {
          await apiRequest('/auth/logout', { method: 'POST', token: result.access_token }).catch(() => {});
          setMessage({ kind: 'info', text: t.teamAccount, switchTo: 'team' });
          return;
        }
        await signIn(result);
        const next = new URLSearchParams(window.location.search).get('next');
        router.push(next?.startsWith('/') ? next : homeFor(result.user?.role, locale));
      }
    } catch (err) {
      // A patient who used the Team tab: a kind note and a button to the patient sign-in.
      if (err.code === 'patient_account') setMessage({ kind: 'info', text: t.patientAccount, switchTo: 'patient' });
      else if (err.code === 'team_account') setMessage({ kind: 'info', text: t.teamAccount, switchTo: 'team' });
      else setMessage({ kind: 'error', text: err.message });
    } finally {
      setWorking(false);
    }
  }

  const submit = (e) => {
    e.preventDefault();
    if (tab === 'team') {
      return run(() => apiRequest('/auth/staff/login', { method: 'POST', body: { email: form.email, password: form.password } }), 'team');
    }
    if (method === 'email' && !codeSentTo) {
      return run(async () => {
        await apiRequest('/auth/email/start', { method: 'POST', body: { email: form.email } });
        setCodeSentTo(form.email);
      });
    }
    if (method === 'email') {
      return run(() => apiRequest('/auth/email/verify', { method: 'POST', body: { email: codeSentTo, code: form.code } }), 'patient');
    }
    if (method === 'phone') {
      const { phone, full_name, date_of_birth } = form;
      return run(() => apiRequest('/auth/phone', { method: 'POST', body: { phone, full_name, date_of_birth } }), 'patient');
    }
    return run(() => apiRequest('/auth/code', { method: 'POST', body: { code: form.personal } }), 'patient');
  };

  if (status === 'signed-in') {
    return (
      <GlassCard className={styles.card}>
        <p className={styles.signedIn}>{t.signedIn.replace('{name}', user.full_name ?? user.email ?? '')}</p>
        <div className={styles.row}>
          {user.role === 'patient' ? (
            <Magnetic href={localePath(locale, '/book')}>{t.book}</Magnetic>
          ) : (
            <Magnetic href={homeFor(user.role, locale)}>{t.goDashboard}</Magnetic>
          )}
          <button type="button" className={styles.link} onClick={signOut}>
            {t.signOut}
          </button>
        </div>
      </GlassCard>
    );
  }

  const tabs = [
    ['patient', t.tabPatient],
    ['team', t.tabTeam],
  ];
  const methods = [
    ['email', t.methodEmail],
    ['phone', t.methodPhone],
    ['code', t.methodCode],
  ];

  return (
    <GlassCard className={styles.card}>
      <div className={styles.tabs} role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => (setTab(id), setMessage(null))}>
            {label}
          </button>
        ))}
        <span className={styles.tabPill} style={{ '--i': tab === 'team' ? 1 : 0 }} aria-hidden="true" />
      </div>

      {tab === 'patient' && (
        <div className={styles.methods}>
          {methods.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={method === id} onClick={() => (setMethod(id), setMessage(null))}>
              {label}
            </button>
          ))}
        </div>
      )}

      <form className={styles.form} onSubmit={submit} key={`${tab}-${method}-${Boolean(codeSentTo)}`}>
        {tab === 'team' && (
          <>
            <Field label={t.email} type="email" autoComplete="username" required {...field('email')} />
            <Field label={t.password} type="password" autoComplete="current-password" required {...field('password')} />
          </>
        )}
        {tab === 'patient' && method === 'email' && !codeSentTo && <Field label={t.email} type="email" autoComplete="email" required {...field('email')} />}
        {tab === 'patient' && method === 'email' && codeSentTo && (
          <>
            <p className={styles.info}>{t.codeSent.replace('{email}', codeSentTo)}</p>
            <Field label={t.code} inputMode="numeric" autoComplete="one-time-code" required {...field('code')} />
            <button type="button" className={styles.link} onClick={() => setCodeSentTo(null)}>
              {t.changeEmail}
            </button>
          </>
        )}
        {tab === 'patient' && method === 'phone' && (
          <>
            <Field label={t.phone} hint={t.phoneHint} type="tel" autoComplete="tel" dir="ltr" required {...field('phone')} />
            <Field label={t.fullName} autoComplete="name" required {...field('full_name')} />
            <Field label={t.dob} type="date" autoComplete="bday" required {...field('date_of_birth')} />
          </>
        )}
        {tab === 'patient' && method === 'code' && (
          <Field label={t.personalCode} hint={t.personalCodeHint} autoComplete="one-time-code" dir="ltr" required {...field('personal')} />
        )}

        {message && (
          <p className={message.kind === 'error' ? styles.error : styles.info} role="alert">
            {message.text}
            {message.switchTo && (
              <button type="button" className={styles.link} onClick={() => (setTab(message.switchTo), setMessage(null))}>
                {message.switchTo === 'patient' ? t.usePatientTab : t.useTeamTab}
              </button>
            )}
          </p>
        )}
        <button type="submit" className={styles.submit} disabled={working}>
          {working ? t.working : tab === 'patient' && method === 'email' && !codeSentTo ? t.sendCode : t.signIn}
        </button>
      </form>

      <div className={styles.demo}>
        <p>
          <strong>{t.demoTitle}</strong> {t.demoText}
        </p>
        <div className={styles.row}>
          <button
            type="button"
            onClick={() => {
              setTab('patient');
              setMethod('phone');
              setForm((f) => ({ ...f, ...DEMO_PATIENT }));
              setMessage({ kind: 'info', text: t.demoFilled });
            }}
          >
            {t.demoPatient}
          </button>
          {DEMO_VIEWER && (
            <button
              type="button"
              onClick={() => {
                setTab('team');
                setForm((f) => ({ ...f, email: DEMO_VIEWER.email, password: DEMO_VIEWER.password }));
                setMessage({ kind: 'info', text: t.demoFilled });
              }}
            >
              {t.demoViewer}
            </button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

/** Where each person lands after signing in: the owner (and the demo viewer) on the owner
 * overview, staff on today's dashboard, patients on the home page. */
function homeFor(role, locale) {
  if (role === 'owner' || role === 'viewer') return localePath(locale, '/owner');
  if (role === 'staff') return localePath(locale, '/dashboard');
  return localePath(locale);
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
