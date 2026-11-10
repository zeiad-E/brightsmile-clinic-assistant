'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import styles from './fx.module.css';

const GLYPHS = '!-_/[]{}=+*^?#0123456789';

/**
 * The text decode from trial 001: each letter flickers through random symbols, then settles, from
 * start to end. Screen readers get the real text straight away (aria-label).
 *
 * Arabic is shown whole, with no flicker: its letters join only when a word is ONE piece of text.
 * Building it letter by letter showed «تم الحجز» as loose letters (on iPhone even after it settled).
 * For the same reason the settled text is always put back as one piece.
 */
const JOINED_LETTERS = /\p{Script=Arabic}/u;

export default function DecodeText({ text, as: Tag = 'span', className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (prefersReducedMotion() || JOINED_LETTERS.test(text)) {
      el.textContent = text;
      return;
    }
    const plan = [...text].map((ch, i) => ({ ch, end: 6 + i * 1.2 + Math.random() * 12 }));
    let frame = 0;
    let id = 0;
    const tick = () => {
      if (plan.every((q) => frame >= q.end || q.ch === ' ')) {
        el.textContent = text; // settled: one piece of text again
        return;
      }
      el.replaceChildren(
        ...plan.map((q) =>
          frame >= q.end || q.ch === ' '
            ? q.ch
            : Object.assign(document.createElement('span'), {
                className: styles.scr,
                textContent: GLYPHS[(Math.random() * GLYPHS.length) | 0],
              }),
        ),
      );
      frame++;
      id = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(id);
  }, [text]);

  // The effect rewrites the letters inside the span itself; `key` makes React swap the whole span
  // (instead of patching text it no longer owns) when the text changes.
  return (
    <Tag className={className} aria-label={text}>
      <span key={text} ref={ref} aria-hidden="true">
        {text}
      </span>
    </Tag>
  );
}
