'use client';

import { useRef } from 'react';
import { clamp, pinProgress, useFrameWhileVisible } from '@/lib/motion';
import styles from './Home.module.css';

/** 2 · Pinned story: four beats take turns while the tooth turns to a new angle for each. */
export default function Story({ beats }) {
  const sectionRef = useRef(null);
  const textRef = useRef(null);
  const railRef = useRef(null);

  useFrameWhileVisible(sectionRef, () => {
    const p = pinProgress(sectionRef.current);
    const items = textRef.current.children;
    const n = items.length;
    [...items].forEach((beat, i) => {
      const d = (p - (i + 0.5) / n) * n;
      let o = clamp(1 - (Math.abs(d) - 0.3) * 5);
      if ((i === 0 && d < 0) || (i === n - 1 && d > 0)) o = 1;
      beat.style.opacity = o;
      beat.style.transform = `translateY(${-d * 60}px)`;
    });
    railRef.current.style.height = `${p * 100}%`;
  });

  return (
    <section ref={sectionRef} className={styles.story} id="story">
      <div className={styles.pin} data-pin>
        <div className={`wrap ${styles.storyGrid}`}>
          <div className={`${styles.spot} ${styles.spotStory}`} data-spot="story" />
          <div ref={textRef} className={styles.storyText}>
            {beats.map((beat) => (
              <div key={beat.b} className={styles.beat}>
                <b>{beat.b}</b>
                <h2>{beat.h}</h2>
                <p>{beat.p}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.rail}>
          <i ref={railRef} />
        </div>
      </div>
    </section>
  );
}
