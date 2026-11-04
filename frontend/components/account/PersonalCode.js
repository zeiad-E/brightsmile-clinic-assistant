'use client';

import { useState } from 'react';
import { apiRequest } from '@/lib/api/client';
import { useSession } from '@/components/providers/SessionProvider';
import PrintCardButton from '@/components/card/PrintCardButton';
import cardStyles from '@/components/card/Card.module.css';
import styles from './Account.module.css';

/**
 * The personal code box on the profile page. The code stays hidden until asked for, and every look
 * is recorded on the API (the audit log). A code from before codes were encrypted can't be shown,
 * only replaced: the API says so with `legacy`.
 */
export default function PersonalCode({ t, me }) {
  const { api } = useSession();
  const [code, setCode] = useState(null);
  const [legacy, setLegacy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState(null); // { kind, text }

  async function run(request, success) {
    setWorking(true);
    setNote(null);
    try {
      await request();
      if (success) setNote({ kind: 'info', text: success });
    } catch (err) {
      setNote({ kind: 'error', text: err.message });
    } finally {
      setWorking(false);
    }
  }

  const show = () =>
    run(async () => {
      const result = await api('/me/personal-code');
      setCode(result.code);
      setLegacy(result.legacy);
    });

  const replace = () =>
    run(async () => {
      const result = await api('/me/personal-code', { method: 'POST' });
      setCode(result.code);
      setLegacy(false);
      setConfirming(false);
    }, t.codeChanged);

  return (
    <section className={styles.box}>
      <h2>{t.codeTitle}</h2>
      <p className={styles.muted}>{t.codeText}</p>
      {legacy ? (
        <p className={styles.notice}>{t.codeLegacy}</p>
      ) : (
        <p className={cardStyles.code} dir="ltr">
          {code ?? '••••-••••'}
        </p>
      )}

      {!confirming ? (
        <div className={styles.actions}>
          <button type="button" disabled={working || !me} onClick={() => (code ? setCode(null) : show())}>
            {code ? t.codeHide : t.codeShow}
          </button>
          <PrintCardButton
            label={t.codePrint}
            disabled={working || !me || legacy}
            load={async () => ({ name: me.full_name, code: (await api('/me/personal-code?for=print')).code })}
            onError={(err) => setNote({ kind: 'error', text: err.message })}
          />
          {me?.email && (
            <button type="button" disabled={working} onClick={() => run(() => apiRequest('/auth/code/resend', { method: 'POST', body: { email: me.email } }), t.codeSent)}>
              {t.codeButton}
            </button>
          )}
          <button type="button" disabled={working || !me} onClick={() => setConfirming(true)}>
            {t.codeNew}
          </button>
        </div>
      ) : (
        <div className={styles.confirm}>
          <p>{t.codeNewConfirm}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={working} onClick={replace}>
              {t.codeNewYes}
            </button>
            <button type="button" onClick={() => setConfirming(false)}>
              {t.codeNewKeep}
            </button>
          </div>
        </div>
      )}
      {note && <p className={note.kind === 'error' ? styles.error : styles.success}>{note.text}</p>}
    </section>
  );
}
