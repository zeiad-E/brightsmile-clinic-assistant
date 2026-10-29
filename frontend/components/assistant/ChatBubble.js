'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { localePath } from '@/i18n/config';
import styles from './ChatBubble.module.css';

// The chat's code is only downloaded the first time someone opens the bubble.
const Chat = dynamic(() => import('./Chat'), { ssr: false });

/** The floating chat button on every public page (except /assistant, which is the chat itself). */
export default function ChatBubble({ t, locale }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // keep the chat alive after closing, so it remembers

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (pathname.endsWith('/assistant')) return null;

  return (
    <div className={styles.root}>
      {opened && (
        <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`} role="dialog" aria-label={t.botName} aria-hidden={!open}>
          <Chat t={t} locale={locale} variant="panel" />
          <Link className={styles.full} href={localePath(locale, '/assistant')} onClick={() => setOpen(false)}>
            {t.openFull} <span aria-hidden="true">↗</span>
          </Link>
        </div>
      )}
      <button
        type="button"
        className={`${styles.button} ${open ? styles.buttonOpen : ''}`}
        aria-expanded={open}
        aria-label={open ? t.bubbleClose : t.bubbleOpen}
        onClick={() => {
          setOpened(true);
          setOpen((value) => !value);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconChat}>
          <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A1.5 1.5 0 0 1 4 14.5Z" />
        </svg>
        <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconClose}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
        {!opened && <span className={styles.ping} aria-hidden="true" />}
      </button>
    </div>
  );
}
