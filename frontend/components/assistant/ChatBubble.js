'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { localePath } from '@/i18n/config';
import styles from './ChatBubble.module.css';

// The chat's code is only downloaded the first time someone opens the bubble.
const Chat = dynamic(() => import('./Chat'), { ssr: false });

const GREETED = 'brightsmile.greeted'; // sessionStorage: this visit has already seen the greeting
const GREET_AFTER = 1000; // ms after the page wakes up, so it follows the hero text instead of competing with it
const GREET_FOR = 12000; // ms before it leaves on its own

/**
 * The floating chat button on every public page (except /assistant, which is the chat itself).
 * Once per visit a small pill appears beside it, with one ready question to tap: the real
 * assistant answers it right there, so a visitor sees what it can do without typing anything.
 */
export default function ChatBubble({ t, locale }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false); // keep the chat alive after closing, so it remembers
  const [greeting, setGreeting] = useState(false);
  const [ask, setAsk] = useState(null); // the ready question, handed to the chat when it opens

  useEffect(() => {
    if (opened || pathname.endsWith('/assistant')) return;
    let seen = null;
    try {
      seen = sessionStorage.getItem(GREETED);
    } catch {
      // storage blocked: it just greets again on the next page
    }
    if (seen) return;
    const timer = setTimeout(() => {
      setGreeting(true);
      try {
        sessionStorage.setItem(GREETED, '1');
      } catch {
        // same as above
      }
    }, GREET_AFTER);
    return () => clearTimeout(timer);
  }, [opened, pathname]);

  // It never stays in the way: it leaves on its own, or as soon as the visitor starts scrolling.
  useEffect(() => {
    if (!greeting) return;
    const hide = () => setGreeting(false);
    const timer = setTimeout(hide, GREET_FOR);
    window.addEventListener('scroll', hide, { once: true, passive: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener('scroll', hide);
    };
  }, [greeting]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (pathname.endsWith('/assistant')) return null;

  return (
    <div className={styles.root}>
      {greeting && (
        <div className={styles.greet} role="status">
          <button
            type="button"
            className={styles.greetAsk}
            onClick={() => {
              setGreeting(false);
              setAsk(t.chips[0]);
              setOpened(true);
              setOpen(true);
            }}
          >
            <span className={styles.greetLead}>{t.greetLead}</span> {t.chips[0]}
          </button>
          <button type="button" className={styles.greetClose} aria-label={t.greetClose} onClick={() => setGreeting(false)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
      {opened && (
        <div className={`${styles.panel} ${open ? styles.panelOpen : ''}`} role="dialog" aria-label={t.botName} aria-hidden={!open}>
          <Chat t={t} locale={locale} variant="panel" ask={ask} />
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
          setGreeting(false);
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
