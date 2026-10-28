'use client';

import { useRef } from 'react';
import { clamp, easeOut, pinProgress, useFrameWhileVisible } from '@/lib/motion';
import { TOOTH_D } from './icons';
import styles from './Home.module.css';

/**
 * 3 · Portal: the page is dark, with a tooth-shaped window in it. As you scroll, the window grows
 * until you "fly through" it into the clinic.
 */
export default function Portal({ t }) {
  const sectionRef = useRef(null);
  const sceneRef = useRef(null);
  const copyRef = useRef(null);
  const holeRef = useRef(null);
  const ringRef = useRef(null);

  useFrameWhileVisible(sectionRef, () => {
    const p = pinProgress(sectionRef.current);
    const s = 1.1 * Math.pow(56, Math.pow(clamp(p / 0.85), 1.5)); // exponential growth reads as flying at a steady speed
    const transform = `translate(500 270) scale(${s}) translate(-100 -80)`;
    holeRef.current.setAttribute('transform', transform);
    ringRef.current.setAttribute('transform', transform);
    ringRef.current.style.opacity = clamp(1 - p * 1.8);
    copyRef.current.style.opacity = clamp(1 - p * 3.2);
    copyRef.current.style.transform = `scale(${1 + p * 1.4})`;
    sceneRef.current.style.transform = `scale(${1.28 - 0.28 * easeOut(p)})`;
    [...sceneRef.current.querySelectorAll('[data-word]')].forEach((word, i) => {
      const q = easeOut(clamp((p - 0.6 - i * 0.06) / 0.16));
      word.style.opacity = q;
      word.style.transform = `translateY(${(1 - q) * 24}px)`;
    });
  });

  return (
    <section ref={sectionRef} className={styles.portal} id="portal">
      <div className={styles.pin} data-pin>
        <div ref={sceneRef} className={styles.portalScene}>
          <div className={styles.psGlow} />
          <small data-word>{t.small}</small>
          <h2 data-word>{t.title}</h2>
          <div data-word className={styles.psChips}>
            {t.chips.map((chip) => (
              <span key={chip}>{chip}</span>
            ))}
          </div>
        </div>
        <svg className={styles.portalMask} viewBox="0 0 1000 625" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <mask id="portalHole">
              <rect x="-2000" y="-2000" width="5000" height="5000" fill="#fff" />
              <path ref={holeRef} d={TOOTH_D} fill="#000" />
            </mask>
          </defs>
          <rect x="-2000" y="-2000" width="5000" height="5000" fill="#0b2545" mask="url(#portalHole)" />
          <path ref={ringRef} d={TOOTH_D} fill="none" stroke="#5eead4" strokeWidth="2.5" vectorEffect="non-scaling-stroke" />
        </svg>
        <div ref={copyRef} className={styles.portalCopy}>
          <span>{t.stepInside}</span>
          <b>{t.brand}</b>
        </div>
      </div>
    </section>
  );
}
