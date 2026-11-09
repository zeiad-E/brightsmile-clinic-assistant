'use client';

import { useRef } from 'react';
import { clamp, easeOut, pinProgress, useFrameWhileVisible } from '@/lib/motion';
import { TOOTH_D } from './icons';
import styles from './Home.module.css';

// The dark cover with a tooth-shaped hole, as ONE shape: a huge square plus the tooth outline.
// fill-rule "evenodd" leaves the area inside the tooth empty (inside two outlines = outside again).
// It used to be an SVG <mask>, and a phone has to rebuild a mask image of the whole screen on every
// frame of the scroll: that was the lag. The square is in the tooth's own units, so however much the
// tooth grows, the square grows with it and still covers the screen.
const HOLE_D = `M-3000 -3000 H3200 V3200 H-3000 Z ${TOOTH_D}`;

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
  const lastP = useRef(-1);
  const lastWords = useRef([]);

  useFrameWhileVisible(sectionRef, () => {
    const p = pinProgress(sectionRef.current);
    // Not scrolling: skip. Re-setting the mask, even to the same value, repaints the whole dark screen.
    if (p === lastP.current) return;
    lastP.current = p;
    const s = 1.1 * Math.pow(56, Math.pow(clamp(p / 0.85), 1.5)); // exponential growth reads as flying at a steady speed
    const transform = `translate(500 270) scale(${s}) translate(-100 -80)`;
    holeRef.current.setAttribute('transform', transform);
    ringRef.current.setAttribute('transform', transform);
    ringRef.current.style.opacity = clamp(1 - p * 1.8);
    copyRef.current.style.opacity = clamp(1 - p * 3.2);
    copyRef.current.style.transform = `scale(${1 + p * 1.4})`;
    sceneRef.current.style.transform = `scale(${1.28 - 0.28 * easeOut(p)})`;
    [...sceneRef.current.querySelectorAll('[data-word]')].forEach((word, i) => {
      // The words start as soon as the window is wide enough to frame them (0.36), right after "Step
      // inside" has faded (0.31). They used to wait until 0.6, leaving an empty screen people stopped at.
      const q = easeOut(clamp((p - 0.36 - i * 0.05) / 0.14));
      if (q === lastWords.current[i]) return; // most of the scroll they sit at 0 or 1: don't touch them
      lastWords.current[i] = q;
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
          <path ref={holeRef} d={HOLE_D} fill="#0b2545" fillRule="evenodd" />
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
