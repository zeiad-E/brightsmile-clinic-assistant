'use client';

import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import styles from './fx.module.css';

/** A random pause between bursts, so the flicker never feels mechanical. */
const pause = () => 900 + Math.random() * 1200;

/**
 * The hover glitch from trial 001: two coloured copies of the text flicker out of line for a moment.
 * Plays once when it appears, then in short bursts while the pointer is over it.
 */
export default function Glitch({ children, className = '' }) {
  const ref = useRef(null);
  const timer = useRef(0);
  const hovering = useRef(false);

  const burst = () => {
    if (prefersReducedMotion()) return;
    ref.current.classList.add(styles.glitching);
    setTimeout(() => ref.current?.classList.remove(styles.glitching), 420);
    if (hovering.current) timer.current = setTimeout(burst, pause());
  };
  const start = () => {
    if (hovering.current) return;
    hovering.current = true;
    burst();
  };
  const stop = () => {
    hovering.current = false;
    clearTimeout(timer.current);
  };

  useEffect(() => {
    const first = setTimeout(burst, 600);
    return () => {
      clearTimeout(first);
      clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);

  return (
    <span ref={ref} className={`${styles.glitch} ${className}`} onPointerEnter={start} onPointerLeave={stop}>
      <span className={styles.g0}>{children}</span>
      <span className={`${styles.gcopy} ${styles.g1}`} aria-hidden="true">
        {children}
      </span>
      <span className={`${styles.gcopy} ${styles.g2}`} aria-hidden="true">
        {children}
      </span>
    </span>
  );
}
