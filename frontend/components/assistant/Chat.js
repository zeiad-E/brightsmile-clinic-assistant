'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat } from '@/lib/api/chat';
import { apiRequest } from '@/lib/api/client';
import { useSession } from '@/components/providers/SessionProvider';
import DecodeText from '@/components/fx/DecodeText';
import { intlLocale } from '@/i18n/config';
import { formatPrice } from '@/lib/format';
import CodeReveal from '@/components/card/CodeReveal';
import DetailsForm from './DetailsForm';
import styles from './Chat.module.css';

/**
 * The clinic assistant chat, used full screen on /assistant and inside the floating bubble.
 *
 * - Replies type out live (Server-Sent Events, see lib/api/chat.js) with a status line while the
 *   assistant works ("Checking free times…").
 * - The assistant can attach cards: free times (tap one to ask for it), a details form (DetailsForm.js:
 *   name, birth date, phone, email, checked while typing), a booking summary (confirm or change),
 *   a confirmation, or your appointments. Cards arrive WITH the finished reply (never while the
 *   assistant is still working), and speak the chat's language, not the page's (`words` has both).
 * - If the assistant signs you in during the chat, the whole site learns it (useSession().signInWithTicket).
 * - Coming back: the server remembers the chat (GET /api/chat/current) — a guest's through a private
 *   cookie on this browser, a patient's in their account — so closing the site loses nothing.
 *   Signing in keeps the same chat (the server moves it into the account); signing out starts a
 *   fresh one. sessionStorage is only a quick copy for this tab, which also keeps the cards.
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

export default function Chat({ t, words = null, locale, variant = 'page', ask = null }) {
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const [team, setTeam] = useState(null); // first name of the team member answering, or null
  const conversationId = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const { getToken, signInWithTicket, user, status: session } = useSession();

  // restore the conversation of this tab at once (the server's answer below may replace it)
  useEffect(() => {
    const saved = load();
    conversationId.current = saved.conversationId;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage only exists in the browser, after the page has loaded
    setMessages(saved.messages.map((m) => ({ ...m, id: nextId++ })));
  }, []);

  // Ask the server which chat this visitor has, once we know who they are, and again whenever they
  // sign in or out. Same chat as on screen → keep the screen (it has the cards, e.g. a personal
  // code shown once). Another chat → show it (this tab's copy if it has one, else the server's
  // text: old free-time cards could be taken by now). None → a fresh chat.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (session === 'loading' || busy) return;
    let stale = false;
    (async () => {
      let found;
      try {
        found = (await apiRequest('/chat/current', { token: await getToken().catch(() => null) })).conversation;
      } catch {
        return; // offline, or an older server without /chat/current: keep this tab's copy
      }
      if (stale || found?.id === conversationId.current) return;
      if (!found) {
        if (!conversationId.current) return;
        conversationId.current = null; // e.g. signed out: that chat is in the account now
        setMessages([]);
        setTeam(null);
        return;
      }
      const saved = load();
      conversationId.current = found.id;
      setTeam(found.with_team ? (found.team_member ?? t.someone) : null);
      setMessages(
        saved.conversationId === found.id
          ? saved.messages.map((m) => ({ ...m, id: nextId++ }))
          : found.messages
              .filter((m) => m.content)
              .map((m) => ({ id: nextId++, serverId: m.id, role: m.role, content: m.content, ...(m.role === 'staff' && { author: m.author ?? t.someone, event: m.event }) })),
      );
    })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when who is visiting changes, not on every reply
  }, [session, userId]);

  // keep it (only finished messages, never a half-typed reply)
  useEffect(() => {
    if (busy) return;
    try {
      // A personal code stays on the screen only: what is saved here must never hold it.
      const kept = messages.slice(-40).map((m) => (m.cards ? { ...m, cards: m.cards.filter((card) => card.type !== 'personal_code') } : m));
      sessionStorage.setItem(STORE, JSON.stringify({ conversationId: conversationId.current, messages: kept }));
    } catch {
      // storage full or blocked: the chat still works, it just isn't kept
    }
  }, [messages, busy]);

  // Follow the conversation down, unless the visitor scrolled up to read. "Were they at the bottom?"
  // is judged by the height BEFORE this update: a reply arrives with its card (a tall form) in one go,
  // and measured afterwards it would always look as if they had scrolled away. Down to the bottom, but
  // never past the start of the newest reply, so a tall card can't push the reply out of sight.
  const shownHeight = useRef(0);
  const follow = useRef(false); // set when the visitor sends: their own message is always shown
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const wasAtBottom = follow.current || shownHeight.current - list.scrollTop - list.clientHeight < 160;
    shownHeight.current = list.scrollHeight;
    follow.current = false;
    if (!wasAtBottom) return;
    const latest = list.querySelector('[data-latest]');
    const replyTop = latest ? list.scrollTop + latest.getBoundingClientRect().top - list.getBoundingClientRect().top - 12 : Infinity;
    list.scrollTop = Math.min(list.scrollHeight, replyTop);
  }, [messages, status]);

  const updateLast = (change) => setMessages((all) => [...all.slice(0, -1), { ...all.at(-1), ...change(all.at(-1)) }]);

  // `form`: the details form's values, sent with the message. Returns { ok }, or { fieldErrors } when
  // the server refused a field, so the form can show it (the message is then taken back off the screen).
  const send = useCallback(
    async (text, { form } = {}) => {
      const message = text.trim();
      if (!message || busy) return { ok: false };
      // Typing (the field has focus)? Then give the field back after the answer. Not after a tapped
      // chip or slot: on a phone that would pop the keyboard up over the answer.
      const typing = document.activeElement === inputRef.current;
      setInput('');
      follow.current = true;
      setBusy(true);
      setStatus(team ? null : t.thinking);
      setMessages((all) => [...all, { id: nextId++, role: 'user', content: message }, { id: nextId++, role: 'assistant', content: '', cards: [], streaming: true }]);

      let outcome = { ok: true };
      await streamChat(
        { message, conversationId: conversationId.current, token: await getToken().catch(() => null), language: locale, form },
        {
          onConversation: (id) => {
            conversationId.current = id;
          },
          onStatus: (s) => setStatus(s.text),
          onToken: (piece) => {
            setStatus(null);
            updateLast((m) => ({ content: m.content + piece }));
          },
          onDone: (result) => {
            // the assistant signed the patient in: swap the one-time ticket for a real session
            if (result.sign_in_ticket) signInWithTicket(result.sign_in_ticket).catch(() => {});
            if (result.status === 'with_team') {
              // a team member has the chat: no assistant reply, their answer arrives by polling
              setTeam(result.team_member ?? t.someone);
              setMessages((all) => all.slice(0, -1));
              return;
            }
            // the cards come with the finished reply, below it (the server sends only the final ones)
            updateLast(() => ({ content: result.reply, cards: result.cards ?? [], streaming: false }));
          },
          onError: (err) => {
            const fieldErrors = form && err.error === 'validation_error' ? fieldErrorsOf(err.details) : null;
            if (fieldErrors) {
              outcome = { ok: false, fieldErrors };
              setMessages((all) => all.slice(0, -2));
              return;
            }
            outcome = { ok: false };
            updateLast(() => ({ content: err.message || t.error, error: true, streaming: false }));
          },
        },
      );

      setMessages((all) => (all.at(-1)?.streaming ? [...all.slice(0, -1), { ...all.at(-1), streaming: false }] : all));
      setStatus(null);
      setBusy(false);
      if (typing) inputRef.current?.focus({ preventScroll: true });
      return outcome;
    },
    [busy, getToken, locale, signInWithTicket, t, team],
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

  // /assistant?q=… (from the Services page) or the bubble's greeting asks that question straight away, once
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get('q') ?? ask;
    if (!q) return;
    if (params.has('q')) {
      params.delete('q');
      window.history.replaceState(null, '', `${window.location.pathname}${params.size ? `?${params}` : ''}`);
    }
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
              <Bubble role={m.role} error={m.error} streaming={m.streaming} latest={m.id === lastId && m.role !== 'user'}>
                {m.content}
              </Bubble>
            )}
            {m.cards?.map((card, i) => (
              <Card key={i} card={card} t={t} words={words} locale={locale} name={user?.full_name} reply={m.content} active={m.id === lastId && !busy} onSend={send} />
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
          enterKeyHint="send"
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
function Bubble({ role, error, streaming, latest = false, children }) {
  const parts = String(children).split(/(\*\*[^*]+\*\*)/g);
  return (
    <p className={`${styles.bubble} ${styles[role]} ${error ? styles.error : ''} ${streaming ? styles.streaming : ''}`} dir="auto" data-latest={latest || undefined}>
      {parts.map((part, i) => (part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part))}
    </p>
  );
}

const dayLabel = (date, locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const dateLabel = (date, locale) => new Intl.DateTimeFormat(intlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const weekdayOf = (date, locale) => new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
const timeLabel = (time, locale) => {
  const [h, m] = time.split(':').map(Number);
  return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-EG' : 'en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1, h, m)));
};

/** The cards the assistant attaches to a reply. Buttons only work on the latest reply. */
/**
 * What the booking card's buttons send. It follows the CHAT's language (the reply the card came
 * with), not the page's: on the English page an Arabic chat must still get Arabic, or the next
 * reply switches to English. Egyptian wording, like the patient would type it.
 */
const CARD_PROMPTS = {
  en: {
    confirm: 'Yes, please confirm the booking.',
    change: "I'd like to change something.",
    form: { booking: 'Here are my details.', sign_in: 'Here are my sign-in details.', sign_up: 'Here are my details for the account.' },
  },
  ar: {
    confirm: 'أيوه، أكّد الحجز من فضلك.',
    change: 'عاوز أغيّر حاجة.',
    form: { booking: 'دي بياناتي.', sign_in: 'دي بيانات الدخول بتاعتي.', sign_up: 'دي بياناتي للحساب.' },
  },
};

/** The server's "form.phone: …" errors → { phone: '…' }, for the details form. */
function fieldErrorsOf(details) {
  const errors = {};
  for (const { path, message } of Array.isArray(details) ? details : []) {
    if (path?.startsWith('form.')) errors[path.slice(5)] = message;
  }
  return Object.keys(errors).length ? errors : null;
}

/** 'ar' or 'en' by which letters the text mostly uses; null when it has no letters. */
export function chatLanguage(text) {
  const arabic = (String(text ?? '').match(/[؀-ۿ]/g) ?? []).length;
  const latin = (String(text ?? '').match(/[A-Za-z]/g) ?? []).length;
  if (!arabic && !latin) return null;
  return arabic >= latin ? 'ar' : 'en';
}

function Card({ card, words, reply, ...page }) {
  // A card speaks the CHAT's language (the reply it came with), not the page's: an Arabic chat on
  // the English page gets Arabic free times, form and summary, and a tapped time sends Arabic text,
  // so the assistant keeps answering in Arabic.
  const locale = chatLanguage(reply) ?? page.locale;
  const t = words?.[locale] ?? page.t;
  return (
    <div className={styles.cardLang} lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <CardBody card={card} t={t} locale={locale} name={page.name} active={page.active} onSend={page.onSend} />
    </div>
  );
}

function CardBody({ card, t, locale, name, active, onSend }) {
  const ar = locale === 'ar';
  if (card.type === 'slots') {
    const doctors = card.doctors.filter((d) => d.days.length);
    if (!doctors.length) return null;
    return (
      <div className={styles.card}>
        <p className={styles.cardTitle}>{t.slotsTitle.replace('{service}', (ar && card.service_ar) || card.service)}</p>
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

  if (card.type === 'details_form') {
    return (
      <DetailsForm
        card={card}
        t={t}
        locale={locale}
        active={active}
        className={styles.card}
        when={card.booking && `${dayLabel(card.booking.date, locale)} · ${timeLabel(card.booking.time, locale)}`}
        onSubmit={(form) => onSend(CARD_PROMPTS[locale].form[form.purpose], { form })}
      />
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
          {/* a new patient checks their own details here too, before saying yes */}
          {card.patient_dob && (
            <div>
              <dt>{t.form.dob}</dt>
              <dd>{dateLabel(card.patient_dob, locale)}</dd>
            </div>
          )}
          {card.patient_phone && (
            <div>
              <dt>{t.form.phone}</dt>
              <dd dir="ltr">{card.patient_phone}</dd>
            </div>
          )}
          {card.patient_email && (
            <div>
              <dt>{t.form.email}</dt>
              <dd dir="ltr">{card.patient_email}</dd>
            </div>
          )}
        </dl>
        {confirmed ? (
          <p className={styles.note}>{t.reminder}</p>
        ) : (
          active && (
            <div className={styles.cardActions}>
              <button type="button" className={styles.primary} onClick={() => onSend(CARD_PROMPTS[locale].confirm)}>
                {t.confirm}
              </button>
              <button type="button" onClick={() => onSend(CARD_PROMPTS[locale].change)}>
                {t.change}
              </button>
            </div>
          )
        )}
      </div>
    );
  }

  if (card.type === 'personal_code') return <CodeReveal code={card.code} name={name} locale={locale} />;

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
