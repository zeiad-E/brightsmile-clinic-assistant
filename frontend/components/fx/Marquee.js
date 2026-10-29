'use client';

import { useRef } from 'react';
import { clamp, lerp, prefersReducedMotion, useFrameWhileVisible } from '@/lib/motion';
import styles from './fx.module.css';

/**
 * The velocity marquee from trial 001: big words drift sideways forever, speed up and lean (skew)
 * while you scroll, and keep drifting the way you last scrolled. Lines alternate direction.
 * The track is laid out left-to-right on purpose (the loop maths needs it); Arabic words inside
 * still read right-to-left.
 */
export default function Marquee({ lines }) {
  const ref = useRef(null);
  const state = useRef({ x: lines.map((_, i) => -i * 260), lastY: 0, vel: 0, flow: 1 });

  useFrameWhileVisible(ref, () => {
    if (prefersReducedMotion()) return;
    const s = state.current;
    const dy = window.scrollY - (s.lastY || window.scrollY);
    s.lastY = window.scrollY;
    s.vel = lerp(s.vel, dy, 0.15);
    if (Math.abs(dy) > 0.5) s.flow = Math.sign(dy);
    const skew = clamp(-s.vel * 0.35, -14, 14);

    [...ref.current.querySelectorAll('[data-track]')].forEach((track, i) => {
      const dir = i % 2 ? -1 : 1;
      const half = track.firstChild.offsetWidth;
      s.x[i] -= dir * (1.1 * s.flow + s.vel * 0.5);
      if (s.x[i] <= -half) s.x[i] += half;
      if (s.x[i] > 0) s.x[i] -= half;
      track.style.transform = `translateX(${s.x[i]}px) skewX(${skew * dir}deg)`;
    });
  });

  return (
    <div ref={ref} className={styles.marquee} aria-hidden="true" dir="ltr">
      {lines.map((line, i) => (
        <div key={i} className={`${styles.mqLine} ${i % 2 ? styles.outline : ''}`}>
          <div data-track className={styles.mqTrack}>
            <span>{`${line} · `.repeat(4)}</span>
            <span>{`${line} · `.repeat(4)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
