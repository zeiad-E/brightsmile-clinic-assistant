'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import styles from './fx.module.css';

const GLYPHS = '!-_/[]{}=+*^?#0123456789';

/**
 * The text decode from trial 001: each letter flickers through random symbols, then settles, from
 * start to end. Screen readers get the real text straight away (aria-label).
 */
export default function DecodeText({ text, as: Tag = 'span', className = '' }) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (prefersReducedMotion()) {
      el.textContent = text;
      return;
    }
    const plan = [...text].map((ch, i) => ({ ch, end: 6 + i * 1.2 + Math.random() * 12 }));
    let frame = 0;
    let id = 0;
    const tick = () => {
      let done = 0;
      el.replaceChildren(
        ...plan.map((q) => {
          if (frame >= q.end || q.ch === ' ') {
            done++;
            return q.ch;
          }
          return Object.assign(document.createElement('span'), {
            className: styles.scr,
            textContent: GLYPHS[(Math.random() * GLYPHS.length) | 0],
          });
        }),
      );
      frame++;
      if (done < plan.length) id = requestAnimationFrame(tick);
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
