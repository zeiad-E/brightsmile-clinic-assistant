'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from '@/lib/api/chat';
import { apiRequest } from '@/lib/api/client';
import { useSession } from '@/components/providers/SessionProvider';
import DecodeText from '@/components/fx/DecodeText';
import { intlLocale } from '@/i18n/config';
import { formatPrice } from '@/lib/format';
import styles from './Chat.module.css';

/**
 * The clinic assistant chat, used full screen on /assistant and inside the floating bubble.
 *
 * - Replies type out live (Server-Sent Events, see lib/api/chat.js) with a status line while the
 *   assistant works ("Checking free times…").
 * - The assistant can attach cards: free times (tap one to ask for it), a booking summary (confirm
 *   or change), a confirmation, or your appointments.
 * - If the assistant signs you in during the chat, the whole site learns it (useSession().signIn).
 * - The conversation is kept in sessionStorage, so the bubble and the full page share it while the
 *   tab is open.
 * - A clinic team member can join the chat from the dashboard ("take over"). The page checks for
 *   their messages every few seconds (every 3 s while they are in the chat) and shows them with
 *   their name; the assistant stays quiet until they hand the chat back.
 */

const STORE = 'brightsmile.chat';
let nextId = 1;

function load() {
  try {
    return JSON.parse(sessionStorage.getItem(STORE)) ?? { conversationId: null, messages: [] };
  } catch {
    return { conversationId: null, messages: [] };
  }
}

export default function Chat({ t, locale, variant = 'page' }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [team, setTeam] = useState(null); // first name of the team member answering, or null
  const conversationId = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const { getToken, signIn, user } = useSession();

  // restore the conversation of this tab
  useEffect(() => {
    const saved = load();
    conversationId.current = saved.conversationId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists in the browser, after the page has loaded
    setMessages(saved.messages.map((m) => ({ ...m, id: nextId++ })));
  }, []);

  // keep it (only finished messages, never a half-typed reply)
  useEffect(() => {
    if (busy) return;
    try {
      sessionStorage.setItem(STORE, JSON.stringify({ conversationId: conversationId.current, messages: messages.slice(-40) }));
    } catch {
      // storage full or blocked: the chat still works, it just isn't kept
    }
  }, [messages, busy]);

  // follow the conversation down, unless the visitor scrolled up to read
  useEffect(() => {
    const list = listRef.current;
    if (list && list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight;
  }, [messages, status]);

  const updateLast = (change) => setMessages((all) => [...all.slice(0, -1), { ...all.at(-1), ...change(all.at(-1)) }]);

  const send = useCallback(
    async (text) => {
      const message = text.trim();
      if (!message || busy) return;
      setInput('');
      setBusy(true);
      setStatus(team ? null : t.thinking);
      setMessages((all) => [...all, { id: nextId++, role: 'user', content: message }, { id: nextId++, role: 'assistant', content: '', cards: [], streaming: true }]);

      await streamChat(
        { message, conversationId: conversationId.current, token: await getToken().catch(() => null), language: locale },
        {
          onConversation: (id) => {
            conversationId.current = id;
          },
          onStatus: (s) => setStatus(s.text),
          onCard: (card) => updateLast((m) => ({ cards: [...(m.cards ?? []), card] })),
          onToken: (piece) => {
            setStatus(null);
            updateLast((m) => ({ content: m.content + piece }));
          },
          onDone: (result) => {
            // only a patient can be signed in from the chat (the API enforces it too)
            if (result.session?.access_token && result.session.user?.role === 'patient') signIn(result.session);
            if (result.status === 'with_team') {
              // a team member has the chat: no assistant reply, their answer arrives by polling
              setTeam(result.team_member ?? t.someone);
              setMessages((all) => all.slice(0, -1));
              return;
            }
            updateLast(() => ({ content: result.reply, streaming: false }));
          },
          onError: (err) => updateLast(() => ({ content: err.message || t.error, error: true, streaming: false })),
        },
      );

      setMessages((all) => (all.at(-1)?.streaming ? [...all.slice(0, -1), { ...all.at(-1), streaming: false }] : all));
      setStatus(null);
      setBusy(false);
      inputRef.current?.focus({ preventScroll: true });
    },
    [busy, getToken, locale, signIn, t, team],
  );

  // Team messages: anything a team member wrote that this tab hasn't shown yet is added at the end.
  const checkTeam = useCallback(async () => {
    const id = conversationId.current;
    if (!id || busy) return;
    try {
      const convo = await apiRequest(`/chat/${id}`, { token: await getToken().catch(() => null) });
      setTeam(convo.with_team ? (convo.team_member ?? t.someone) : null);
      setMessages((all) => {
        const shown = new Set(all.map((m) => m.serverId).filter(Boolean));
        const fresh = convo.messages.filter((m) => m.role === 'staff' && !shown.has(m.id));
        if (!fresh.length) return all;
        return [...all, ...fresh.map((m) => ({ id: nextId++, serverId: m.id, role: 'staff', content: m.content, author: m.author ?? t.someone, event: m.event }))];
      });
    } catch {
      // offline for a moment: the next check tries again
    }
  }, [busy, getToken, t]);

  useEffect(() => {
    const first = setTimeout(checkTeam, 800);
    const every = setInterval(() => document.visibilityState === 'visible' && checkTeam(), team ? 3000 : 12000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [checkTeam, team]);

  // /assistant?q=… (from the Services page) asks that question straight away, once
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q');
    if (!q) return;
    params.delete('q');
    window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    const timer = setTimeout(() => send(q), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);

  const restart = () => {
    conversationId.current = null;
    setMessages([]);
    setTeam(null);
  };

  const lastId = messages.at(-1)?.id;

  return (
    <div className={`${styles.chat} ${styles[variant]}`}>
      <header className={styles.head}>
        <span className={styles.avatar} aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M12 3c-3.6 0-7 2-7 6.2 0 2.6.8 4.4 1.6 6.4.7 1.8 1 5.4 2.6 5.4 1.8 0 1.4-4.6 2.8-4.6s1 4.6 2.8 4.6c1.6 0 1.9-3.6 2.6-5.4.8-2 1.6-3.8 1.6-6.4C19 5 15.6 3 12 3Z" />
          </svg>
        </span>
        <div>
          <p className={styles.name}>{t.botName}</p>
          <p className={`${styles.online} ${team ? styles.withTeam : ''}`}>
            {team ? t.teamWith.replace('{name}', team) : user ? t.signedInAs.replace('{name}', user.full_name ?? '') : t.online}
          </p>
        </div>
        {messages.length > 0 && (
          <button type="button" className={styles.restart} onClick={restart} disabled={busy}>
            {t.newChat}
          </button>
        )}
      </header>

      <div ref={listRef} className={styles.list} aria-live="polite">
        <Bubble role="assistant">{t.hello}</Bubble>
        {messages.map((m) => (
          <div key={m.id} className={styles.turn}>
            {m.role === 'staff' && m.event && (
              <p className={styles.event}>
                <span aria-hidden="true" />
                {(m.event === 'left' ? t.teamLeft : t.teamJoined).replace('{name}', m.author)}
              </p>
            )}
            {m.role === 'staff' && !m.event && <span className={styles.staffName}>{t.teamLabel.replace('{name}', m.author)}</span>}
            {!(m.role === 'staff' && m.event) && (m.content || m.role === 'user' || m.error) && (
              <Bubble role={m.role} error={m.error} streaming={m.streaming}>
                {m.content}
              </Bubble>
            )}
            {m.cards?.map((card, i) => (
              <Card key={i} card={card} t={t} locale={locale} active={m.id === lastId && !busy} onSend={send} />
            ))}
          </div>
        ))}
        {!status && team && messages.at(-1)?.role === 'user' && <p className={styles.status}>{t.teamWillReply.replace('{name}', team)}</p>}
        {status && (
          <p className={styles.status}>
            {status}
            <span className={styles.dots} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </p>
        )}
      </div>

      {messages.length === 0 && (
        <div className={styles.chips}>
          {t.chips.map((chip) => (
            <button key={chip} type="button" onClick={() => send(chip)} disabled={busy}>
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        className={styles.composer}
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          maxLength={1000}
          dir="auto"
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label={t.send}>
          <svg viewBox="0 0 24 24" aria-hidden="true" className="flip-rtl">
            <path d="M4 12h15M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      <div className={styles.foot}>
        <button type="button" onClick={() => send(t.humanPrompt)} disabled={busy}>
          {t.human}
        </button>
        <span>{t.disclaimer}</span>
      </div>
    </div>
  );
}

/** One message. Replies may use **bold**; everything else is plain text. */
function Bubble({ role, error, streaming, children }) {
  const parts = String(children).split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className={`${styles.bubble} ${styles[role]} ${error ? styles.error : ''} ${streaming ? styles.streaming : ''}`} dir="auto">
      {parts.map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}
    </p>
  );
}

const dayLabel = (date, locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const weekdayOf = (date, locale) => new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const timeLabel = (time, locale) => {
  const [h, m] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1, h, m)));
};

/** The cards the assistant attaches to a reply. Buttons only work on the latest reply. */
function Card({ card, t, locale, active, onSend }) {
  const ar = locale === 'ar';
  if (card.type === 'slots') {
    const doctors = card.doctors.filter((d) => d.days.length);
    if (!doctors.length) return null;
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>{t.slotsTitle.replace('{service}', card.service)}</p>
        {doctors.map((d) => {
          const doctor = (ar && d.doctor_ar) || d.doctor;
          return (
            <div key={d.doctor} className={styles.slotDoctor}>
              <p className={styles.slotName}>{doctor}</p>
              {d.days.slice(0, 4).map((day) => (
                <div key={day.date} className={styles.slotDay}>
                  <span>{dayLabel(day.date, locale)}</span>
                  <div className={styles.times}>
                    {day.sample_times.slice(0, 6).map((time) => (
                      <button
                        key={time}
                        type="button"
                        disabled={!active}
                        onClick={() =>
                          onSend(
                            t.pickTime
                              .replace('{weekday}', weekdayOf(day.date, locale))
                              .replace('{date}', day.date)
                              .replace('{time}', time)
                              .replace('{doctor}', doctor),
                          )
                        }
                      >
                        {timeLabel(time, locale)}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (card.type === 'booking_summary' || card.type === 'booking_confirmed') {
    const confirmed = card.type === 'booking_confirmed';
    return (
      <div className={`${styles.card} ${confirmed ? styles.confirmed : ''}`}>
        {confirmed ? (
          <p className={styles.cardTitle}>
            <span className={styles.check} aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </span>
            <DecodeText text={t.confirmedTitle} />
          </p>
        ) : (
          <p className={styles.cardTitle}>{t.summaryTitle}</p>
        )}
        <dl className={styles.summary}>
          <div>
            <dt>{t.when}</dt>
            <dd>
              {dayLabel(card.date, locale)} · {timeLabel(card.time, locale)}
            </dd>
          </div>
          <div>
            <dt>{t.with}</dt>
            <dd>{(ar && card.doctor_ar) || card.doctor}</dd>
          </div>
          <div>
            <dt>{(ar && card.service_ar) || card.service}</dt>
            <dd>
              {t.duration.replace('{n}', card.duration_minutes.toLocaleString(intlLocale(locale)))} · {formatPrice(card.price_egp, locale)}
            </dd>
          </div>
          {card.patient_name && (
            <div>
              <dt>{t.patient}</dt>
              <dd>{card.patient_name}</dd>
            </div>
          )}
        </dl>
        {confirmed ? (
          <p className={styles.note}>{t.reminder}</p>
        ) : (
          active && (
            <div className={styles.cardActions}>
              <button type="button" className={styles.primary} onClick={() => onSend(t.confirmPrompt)}>
                {t.confirm}
              </button>
              <button type="button" onClick={() => onSend(t.changePrompt)}>
                {t.change}
              </button>
            </div>
          )
        )}
      </div>
    );
  }

  if (card.type === 'appointments') {
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>{t.appointmentsTitle}</p>
        {card.appointments.length === 0 ? (
          <p className={styles.note}>{t.none}</p>
        ) : (
          <ul className={styles.appointments}>
            {card.appointments.map((a) => (
              <li key={`${a.date}-${a.time}`}>
                <strong>
                  {dayLabel(a.date, locale)} · {timeLabel(a.time, locale)}
                </strong>
                <span>
                  {a.service} · {a.doctor}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return null;
}
