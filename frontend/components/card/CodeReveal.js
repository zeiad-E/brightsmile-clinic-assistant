'use client';

import { useState } from 'react';
import { COPY } from './copy';
import PrintCardButton from './PrintCardButton';
import styles from './Card.module.css';

/**
 * "Here is your personal code", shown right after an account is made: sign-up, booking or chat.
 * `signInTips`: also tell the patient how to sign in next time and never to share the code (on the
 * patient's own screens; the team dashboard shows the same box to staff, without them).
 */
export default function CodeReveal({ code, name, locale, signInTips = false }) {
  const t = COPY[locale] ?? COPY.en;
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
  }

  return (
    <div className={styles.reveal}>
      <p className={styles.revealTitle}>{t.title}</p>
      <p className={styles.code} dir="ltr">
        {code}
      </p>
      <p className={styles.keep}>{t.keep}</p>
      <div className={styles.buttons}>
        <button type="button" onClick={copy}>
          {copied ? t.copied : t.copy}
        </button>
        <PrintCardButton label={t.print} load={() => ({ name, code })} />
      </div>
      {signInTips && (
        <div className={styles.tips}>
          <p>{t.nextTime}</p>
          <ul>
            <li>{t.wayCode}</li>
            <li>{t.wayPhone}</li>
            <li>{t.wayEmail}</li>
          </ul>
          <p className={styles.never}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <rect x="5" y="11" width="14" height="9" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0v3" />
            </svg>
            {t.neverShare}
          </p>
        </div>
      )}
    </div>
  );
}
