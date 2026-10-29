'use client';

import { useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import styles from './fx.module.css';

/**
 * "Glass, light & grain" from trial 001: a frosted card over soft colour blobs, with film grain.
 * It tilts a little towards the mouse and a light spot follows the pointer.
 */
export default function GlassCard({ children, className = '', tilt = 8 }) {
  const ref = useRef(null);

  const move = (e) => {
    if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
    const card = ref.current;
    const r = card.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    const dx = (e.clientX - r.left) / r.width - 0.5;
    const dy = (e.clientY - r.top) / r.height - 0.5;
    card.style.transform = `rotateY(${dx * tilt}deg) rotateX(${-dy * tilt}deg)`;
  };
  const rest = () => {
    const card = ref.current;
    card.style.transform = '';
    card.style.setProperty('--mx', '50%');
    card.style.setProperty('--my', '30%');
  };

  return (
    <div className={styles.glassStage} onPointerMove={move} onPointerLeave={rest}>
      <div className={styles.mesh} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div ref={ref} className={`${styles.glass} ${className}`}>
        <span className={styles.grain} aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
