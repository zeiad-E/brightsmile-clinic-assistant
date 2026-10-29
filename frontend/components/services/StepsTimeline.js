'use client';

import { useRef } from 'react';
import { clamp, prefersReducedMotion, useFrameWhileVisible } from '@/lib/motion';
import styles from './ServiceDetail.module.css';

/**
 * "What to expect" as a timeline: while you scroll, a mint line draws itself from step to step and
 * each number lights up when the line reaches it. Like the home page, it writes styles straight onto
 * the elements every frame (no React state), and only while the list is on screen.
 */
export default function StepsTimeline({ steps }) {
  const listRef = useRef(null);

  useFrameWhileVisible(listRef, () => {
    const list = listRef.current;
    const dots = [...list.querySelectorAll('[data-dot]')];
    if (dots.length === 0) return;

    // the line runs from the centre of the first number to the centre of the last one
    const top = list.getBoundingClientRect().top;
    const centres = dots.map((dot) => {
      const r = dot.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    list.style.setProperty('--line-top', `${centres[0] - top}px`);
    list.style.setProperty('--line-height', `${centres.at(-1) - centres[0]}px`);

    // the "pen" sits 60% down the screen; everything above it is drawn
    const pen = prefersReducedMotion() ? Infinity : window.innerHeight * 0.6;
    const span = centres.at(-1) - centres[0] || 1;
    list.style.setProperty('--progress', clamp((pen - centres[0]) / span));
    dots.forEach((dot, i) => dot.parentElement.toggleAttribute('data-lit', centres[i] <= pen));
  });

  return (
    <ol ref={listRef} className={styles.steps}>
      {steps.map((step) => (
        <li key={step.number} className={styles.step}>
          <span data-dot className={styles.stepNumber}>
            {step.number}
          </span>
          <p>{step.text}</p>
        </li>
      ))}
    </ol>
  );
}
