'use client';

import { useCallback, useRef, useState } from 'react';
import { useWhenVisible, wait } from '@/lib/motion';
import Logo from '@/components/brand/Logo';
import styles from './Home.module.css';

const cx = (...names) => names.filter(Boolean).join(' ');

/**
 * 7 · The assistant: a scripted conversation plays whenever the chat scrolls into view (typing
 * dots, the answer typing out two letters at a time, a source tag, time slots, a booking).
 * This one uses React state: messages change a few times a second, not every frame.
 */
export default function AssistantDemo({ t }) {
  const chatRef = useRef(null);
  const run = useRef(0);
  const [messages, setMessages] = useState([]);

  const play = useCallback(async () => {
    const id = ++run.current;
    const alive = () => id === run.current;
    const update = (change) => setMessages((all) => [...all.slice(0, -1), { ...all.at(-1), ...change }]);
    // Plays the script, pauses 4 s, then starts over, until the chat leaves the screen (alive() turns false).
    while (alive()) {
      setMessages([]);
      for (const step of t.script) {
        await wait(step.me ? 500 : 150);
        if (!alive()) return;
        if (step.me) {
          setMessages((all) => [...all, { me: true, text: step.me }]);
          continue;
        }
        setMessages((all) => [...all, { typing: true }]);
        await wait(550);
        if (!alive()) return;
        update({ typing: false, text: '', confirm: step.confirm });
        for (let i = 2; i <= step.bot.length + 1; i += 2) {
          if (!alive()) return;
          update({ text: step.bot.slice(0, i) });
          await wait(12);
        }
        if (step.src) update({ src: step.src });
        if (step.slots) {
          update({ slots: step.slots, pick: -1 });
          await wait(450);
          if (!alive()) return;
          update({ pick: step.pick });
        }
      }
      await wait(4000);
    }
  }, [t.script]);

  useWhenVisible(chatRef, play, () => run.current++, 0.4);

  return (
    <section className={`wrap ${styles.assistant}`} id="assistant">
      <div className={styles.assistantCopy}>
        <div className={styles.secHead}>
          <div className="eyebrow">{t.eyebrow}</div>
          <h2>
            {t.titleA}
            <br />
            {t.titleB}
          </h2>
          <ul className={styles.ticks}>
            {t.ticks.map((tick) => (
              <li key={tick}>{tick}</li>
            ))}
          </ul>
        </div>
        <div className={`${styles.spot} ${styles.spotAssistant}`} data-spot="assistant" />
      </div>
      <div ref={chatRef} className={styles.chat} aria-hidden="true">
        <div className={styles.chatHead}>
          <div className={styles.av}>
            <Logo className="block size-5" color="#fff" />
          </div>
          <div>
            <b>{t.name}</b>
            <span>{t.status}</span>
          </div>
        </div>
        <div className={styles.chatBody}>
          {messages.map((m, i) => (
            <div key={i} className={cx(styles.msg, m.me ? styles.me : styles.bot, m.confirm && styles.confirm)}>
              {m.typing ? (
                <span className={styles.dots}>
                  <i />
                  <i />
                  <i />
                </span>
              ) : (
                <span>{m.text}</span>
              )}
              {m.src && <div className={styles.src}>{m.src}</div>}
              {m.slots && (
                <div className={styles.slots}>
                  {m.slots.map((slot, s) => (
                    <span key={slot} className={s === m.pick ? styles.pick : undefined}>
                      {slot}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className={styles.chatInput}>{t.input}</div>
      </div>
    </section>
  );
}
