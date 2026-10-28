'use client';

import { useRef } from 'react';
import { isRtl, lerp, pinProgress, useFrameWhileVisible } from '@/lib/motion';
import { FallbackServiceIcon, SERVICE_ICONS } from './icons';
import styles from './Home.module.css';

/**
 * 4 · Services: the cards slide sideways as you scroll, curving gently like a ribbon (deeper while
 * you scroll fast). In Arabic they slide the other way. Cards come from the live API.
 */
export default function Services({ t, services }) {
  const sectionRef = useRef(null);
  const trackRef = useRef(null);
  const barRef = useRef(null);
  const motion = useRef({ last: 0, speed: 0 });

  useFrameWhileVisible(sectionRef, () => {
    const track = trackRef.current;
    const p = pinProgress(sectionRef.current);
    const travel = Math.max(0, track.scrollWidth - window.innerWidth + 48);
    const x = (isRtl() ? 1 : -1) * p * travel;
    track.style.transform = `translateX(${x}px)`;
    const m = motion.current;
    m.speed = lerp(m.speed, Math.abs(p - m.last) * 60, 0.1);
    m.last = p;
    const bend = 22 + Math.min(m.speed * 600, 26);
    for (const card of track.children) {
      const d = (card.offsetLeft + x + card.offsetWidth / 2 - window.innerWidth / 2) / window.innerWidth;
      card.style.transform = `rotateY(${-d * bend}deg) translateZ(${-Math.abs(d) * 140}px)`;
    }
    barRef.current.style.width = `${p * 100}%`;
  });

  return (
    <section ref={sectionRef} className={styles.services} id="services">
      <div className={styles.pin} data-pin>
        <div className={`wrap ${styles.servicesHead}`}>
          <div>
            <div className={`eyebrow ${styles.light}`}>{t.eyebrow}</div>
            <h2>
              {t.titleA}
              <br />
              {t.titleB}
            </h2>
          </div>
          <div className={`${styles.spot} ${styles.spotServices}`} data-spot="services" />
        </div>
        <div className={styles.trackWrap}>
          <div ref={trackRef} className={styles.track}>
            {services.map((s) => {
              const Icon = SERVICE_ICONS[s.slug] ?? FallbackServiceIcon;
              return (
                <article key={s.slug} className={styles.svc}>
                  <div className={styles.ic}>
                    <Icon />
                  </div>
                  <h3>{s.name}</h3>
                  <div className={styles.meta}>
                    {s.minutes} {t.min} · {s.who}
                  </div>
                  <div className={styles.price}>{s.price}</div>
                </article>
              );
            })}
          </div>
        </div>
        <div className="wrap">
          <div className={styles.bar}>
            <i ref={barRef} />
          </div>
        </div>
      </div>
    </section>
  );
}
