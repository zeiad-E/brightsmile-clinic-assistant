'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { localePath } from '@/i18n/config';
import { apiRequest } from '@/lib/api/client';
import { useSession } from '@/components/providers/SessionProvider';
import styles from './Account.module.css';

/**
 * Profile & privacy: the patient's details, their language, a fresh personal code, and "forget me".
 * Email and phone can be changed here, confirmed with a 6-digit code (a new email confirms itself;
 * a new phone is confirmed from the email already on file). Name and date of birth stay with the
 * clinic: with the phone, they are how phone sign-in recognises the patient.
 */
export default function Profile({ t, locale }) {
  const { api } = useSession();
  const [me, setMe] = useState(null);
  const [notes, setNotes] = useState({}); // per box: { kind, text }
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(null);
  const [changing, setChanging] = useState(null); // 'email' | 'phone' while its change panel is open

  useEffect(() => {
    api('/me')
      .then(setMe)
      .catch((err) => setNotes({ details: { kind: 'error', text: err.message } }));
  }, [api]);

  async function run(box, request, success) {
    setWorking(box);
    setNotes((n) => ({ ...n, [box]: null }));
    try {
      await request();
      setNotes((n) => ({ ...n, [box]: { kind: 'info', text: success } }));
    } catch (err) {
      setNotes((n) => ({ ...n, [box]: { kind: 'error', text: err.message } }));
    } finally {
      setWorking(null);
    }
  }

  const note = (box) => notes[box] && <p className={notes[box].kind === 'error' ? styles.error : styles.success}>{notes[box].text}</p>;
  const dob = me?.date_of_birth && new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(me.date_of_birth));

  return (
    <div className={styles.boxes}>
      <section className={styles.box}>
        <h2>{t.detailsTitle}</h2>
        {me ? (
          <dl className={styles.details}>
            {[
              ['full_name', t.fullName, me.full_name],
              ['dob', t.dob, dob],
              ['email', t.email, me.email],
              ['phone', t.phone, me.phone],
            ].map(([field, label, value]) => (
              <div key={field} className={changing === field ? styles.rowOpen : undefined}>
                <dt>{label}</dt>
                <dd dir={field === 'phone' ? 'ltr' : undefined}>
                  {value || t.empty}
                  {(field === 'email' || field === 'phone') && changing !== field && (
                    <button type="button" className={styles.changeBtn} onClick={() => setChanging(field)}>
                      {t.change}
                    </button>
                  )}
                </dd>
                {(field === 'email' || field === 'phone') && (
                  <div className={styles.reveal} data-open={changing === field || undefined}>
                    <div>
                      {changing === field && (
                        <ContactChange
                          field={field}
                          t={t}
                          hasEmail={Boolean(me.email)}
                          onCancel={() => setChanging(null)}
                          onDone={(updated) => {
                            setMe(updated);
                            setChanging(null);
                            setNotes((n) => ({ ...n, details: { kind: 'info', text: field === 'email' ? t.changedEmail : t.changedPhone } }));
                          }}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </dl>
        ) : (
          <div className={styles.skeleton} aria-hidden="true" />
        )}
        <p className={styles.muted}>{t.detailsNote}</p>
        {note('details')}
      </section>

      <section className={styles.box}>
        <h2>{t.languageTitle}</h2>
        <div className={styles.segmented}>
          {[
            ['en', 'English'],
            ['ar', 'العربية'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={me?.preferred_language === value}
              disabled={!me || working === 'language'}
              onClick={() =>
                run('language', async () => setMe(await api('/me', { method: 'PATCH', body: { preferred_language: value } })), t.saved)
              }
            >
              {label}
            </button>
          ))}
        </div>
        {note('language')}
      </section>

      <section className={styles.box}>
        <h2>{t.codeTitle}</h2>
        <p className={styles.muted}>{t.codeText}</p>
        {me?.email ? (
          <button
            type="button"
            className={styles.primary}
            disabled={working === 'code'}
            onClick={() => run('code', () => apiRequest('/auth/code/resend', { method: 'POST', body: { email: me.email } }), t.codeSent)}
          >
            {t.codeButton}
          </button>
        ) : (
          me && <p className={styles.notice}>{t.codeNoEmail}</p>
        )}
        {note('code')}
      </section>

      <section className={`${styles.box} ${styles.dangerBox}`}>
        <h2>{t.forgetTitle}</h2>
        <p className={styles.muted}>{t.forgetText}</p>
        {!confirming ? (
          <button type="button" className={styles.danger} onClick={() => setConfirming(true)}>
            {t.forgetButton}
          </button>
        ) : (
          <div className={styles.confirm}>
            <p>{t.forgetConfirm}</p>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.dangerSolid}
                disabled={working === 'forget'}
                onClick={() =>
                  run(
                    'forget',
                    async () => {
                      await api('/me/memory', { method: 'DELETE' });
                      setConfirming(false);
                      try {
                        sessionStorage.removeItem('brightsmile.chat'); // the chat kept in this tab goes too
                      } catch {
                        // nothing stored
                      }
                    },
                    t.forgetDone,
                  )
                }
              >
                {t.forgetYes}
              </button>
              <button type="button" onClick={() => setConfirming(false)}>
                {t.forgetKeep}
              </button>
            </div>
          </div>
        )}
        {note('forget')}
        <Link className={styles.smallLink} href={localePath(locale, '/privacy')}>
          {t.privacyLink}
        </Link>
      </section>
    </div>
  );
}

/** Two small steps inside the details card: the new value → the code from the email. */
function ContactChange({ field, t, hasEmail, onCancel, onDone }) {
  const { api } = useSession();
  const [value, setValue] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  async function step(request) {
    setWorking(true);
    setError(null);
    try {
      await request();
    } catch (err) {
      setError(err.message);
    } finally {
      setWorking(false);
    }
  }

  const send = () =>
    step(async () => {
      const result = await api('/me/contact', { method: 'POST', body: { field, value: value.trim() } });
      setSentTo(result.sent_to);
      setCode('');
    });
  const confirm = () => step(async () => onDone(await api('/me/contact/verify', { method: 'POST', body: { field, code } })));

  if (field === 'phone' && !hasEmail) {
    return (
      <div className={styles.changePanel}>
        <p className={styles.notice}>{t.phoneNeedsEmail}</p>
        <div className={styles.actions}>
          <button type="button" onClick={onCancel}>
            {t.cancelChange}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className={styles.changePanel}
      onSubmit={(e) => {
        e.preventDefault();
        if (sentTo) confirm();
        else send();
      }}
    >
      {!sentTo ? (
        <>
          <label className={styles.changeField}>
            <span>{field === 'email' ? t.newEmail : t.newPhone}</span>
            <input
              type={field === 'email' ? 'email' : 'tel'}
              dir="ltr"
              autoComplete={field === 'email' ? 'email' : 'tel'}
              required
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <small>{field === 'email' ? t.emailCodeHint : t.phoneCodeHint}</small>
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={working || !value.trim()}>
              {working ? t.working : t.sendCode}
            </button>
            <button type="button" onClick={onCancel}>
              {t.cancelChange}
            </button>
          </div>
        </>
      ) : (
        <div className={styles.codeStep}>
          <p className={styles.sentLine}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3 6h18v12H3zM3 6l9 7 9-7" />
            </svg>
            {t.codeSentTo.replace('{to}', sentTo)}
          </p>
          <label className={styles.changeField}>
            <span>{t.codeLabel}</span>
            <input
              className={styles.codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              autoFocus
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <div className={styles.actions}>
            <button type="submit" className={styles.primary} disabled={working || code.length !== 6}>
              {working ? t.working : t.confirmChange}
            </button>
            <button type="button" disabled={working} onClick={send}>
              {t.resendCode}
            </button>
            <button type="button" onClick={onCancel}>
              {t.cancelChange}
            </button>
          </div>
        </div>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </form>
  );
}
