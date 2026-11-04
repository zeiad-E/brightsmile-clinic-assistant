'use client';

import { useState } from 'react';
import { COPY } from './copy';
import PrintCardButton from './PrintCardButton';
import styles from './Card.module.css';

/** "Here is your personal code", shown right after an account is made: sign-up, booking or chat. */
export default function CodeReveal({ code, name, locale }) {
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
    </div>
  );
}
