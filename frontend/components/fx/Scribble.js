'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import { useWhenVisible } from '@/lib/motion';
import styles from './fx.module.css';

// Hand-drawn strokes (viewBox 0 0 200 20 for the underline, 200 80 for the circle), from trial 001.
const PATHS = {
  underline: { viewBox: '0 0 200 20', d: 'M4 14 C 40 6, 80 4, 120 9 C 150 12, 175 10, 196 6' },
  circle: { viewBox: '0 0 200 80', d: 'M118 8 C 60 2, 8 14, 6 40 C 4 66, 70 76, 120 72 C 175 68, 196 52, 192 34 C 188 14, 140 4, 96 10' },
};

/** Draws a hand-made underline (or circle) around its words the first time they scroll into view. */
export default function Scribble({ children, shape = 'underline', delay = 0.3 }) {
  const ref = useRef(null);
  const pathRef = useRef(null);
  const [drawn, setDrawn] = useState(false);
  useWhenVisible(ref, () => setDrawn(true), undefined, 0.6);

  useLayoutEffect(() => {
    pathRef.current.style.setProperty('--len', pathRef.current.getTotalLength());
  }, []);

  const { viewBox, d } = PATHS[shape];
  return (
    <span ref={ref} className={`${styles.scribbled} ${drawn ? styles.drawn : ''}`} style={{ '--delay': `${delay}s` }}>
      {children}
      <svg className={`${styles.scribble} ${styles[shape]}`} viewBox={viewBox} preserveAspectRatio="none" aria-hidden="true">
        <path ref={pathRef} d={d} />
      </svg>
    </span>
  );
}
