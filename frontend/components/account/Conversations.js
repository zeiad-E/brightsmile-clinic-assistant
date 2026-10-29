'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { localePath } from '@/i18n/config';
import { useSession } from '@/components/providers/SessionProvider';
import chat from '@/components/assistant/Chat.module.css';
import styles from './Account.module.css';

/** My conversations: past chats with the assistant, newest first; open one to read it (read-only). */
export default function Conversations({ t, locale }) {
  const { api } = useSession();
  const [items, setItems] = useState(null);
  const [opened, setOpened] = useState(null); // { id, title, messages } once loaded
  const [error, setError] = useState(null);

  useEffect(() => {
    api('/me/conversations?limit=50')
      .then((page) => setItems(page.data))
      .catch((err) => (setItems([]), setError(err.message)));
  }, [api]);

  const open = async (item) => {
    setError(null);
    setOpened({ id: item.id, title: item.title, messages: null });
    try {
      const full = await api(`/chat/${item.id}`);
      setOpened({ id: item.id, title: full.title ?? item.title, messages: full.messages });
    } catch (err) {
      setOpened(null);
      setError(err.message);
    }
  };

  const when = (iso) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

  if (opened) {
    return (
      <div className={styles.stack}>
        <button type="button" className={styles.backLink} onClick={() => setOpened(null)}>
          <span className="flip-rtl" aria-hidden="true">←</span> {t.back}
        </button>
        <h2 dir="auto">{opened.title || t.untitled}</h2>
        <div className={`${chat.list} ${styles.transcript}`}>
          {opened.messages === null ? (
            <p className={styles.muted}>…</p>
          ) : (
            opened.messages
              .filter((m) => m.role === 'user' || m.role === 'assistant')
              .map((m, i) => (
                <p key={i} className={`${chat.bubble} ${chat[m.role]}`} dir="auto">
                  {m.content}
                </p>
              ))
          )}
        </div>
        <p className={styles.muted}>
          {t.readOnly} <Link href={localePath(locale, '/assistant')}>{t.startNew}</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {error && <p className={styles.error}>{error}</p>}
      {items === null ? (
        <ul className={styles.list} aria-hidden="true">
          <li className={styles.skeleton} />
        </ul>
      ) : items.length === 0 ? (
        <p className={styles.empty}>
          {t.none} <Link href={localePath(locale, '/assistant')}>{t.startNew}</Link>
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className={styles.chatRow} onClick={() => open(item)}>
                <span className={styles.chatIcon} aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A1.5 1.5 0 0 1 4 14.5Z" />
                  </svg>
                </span>
                <span className={styles.chatMain}>
                  <strong dir="auto">{item.title || t.untitled}</strong>
                  <small>{when(item.last_message_at ?? item.created_at)}</small>
                </span>
                <span className={styles.status}>{t.status[item.status] ?? item.status}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
