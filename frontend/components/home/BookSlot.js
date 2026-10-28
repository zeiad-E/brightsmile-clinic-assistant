'use client';

import { useRef } from 'react';
import ButtonLink from '@/components/ui/ButtonLink';
import styles from './Home.module.css';

/**
 * 9 · Book: the tooth comes to rest beside a frosted-glass card with the real next free slot.
 * The card tilts toward the pointer and a soft light follows it.
 */
export default function BookSlot({ t, slot, assistantHref }) {
  const sectionRef = useRef(null);
  const cardRef = useRef(null);

  const onMove = (e) => {
    const card = cardRef.current;
    const r = card.getBoundingClientRect(), s = sectionRef.current.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    card.style.transform = `rotateY(${((e.clientX - s.left) / s.width - 0.5) * 10}deg) rotateX(${-((e.clientY - s.top) / s.height - 0.5) * 10}deg)`;
  };
  const onLeave = () => {
    cardRef.current.style.transform = '';
  };

  return (
    <section ref={sectionRef} className={styles.book} id="book" onPointerMove={onMove} onPointerLeave={onLeave}>
      <div className={styles.mesh} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </div>
      <div className={styles.grain} aria-hidden="true" />
      <div className={`wrap ${styles.bookGrid}`}>
        <div className={styles.bookCopy}>
          <div className={styles.secHead}>
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{slot ? t.title.replace('{day}', slot.dayWord) : t.fallbackTitle}</h2>
            <p>{t.text}</p>
          </div>
          <div className={`${styles.spot} ${styles.spotBook}`} data-spot="book" />
        </div>
        <div ref={cardRef} className={styles.glass}>
          <small>{t.small}</small>
          {slot ? (
            <>
              <h3>{slot.when}</h3>
              <p>{t.with.replace('{service}', slot.service).replace('{doctor}', slot.doctor)}</p>
              <div className={styles.pills}>
                <span>{slot.duration}</span>
                <span>{slot.price}</span>
                <span>{t.reminder}</span>
              </div>
              <ButtonLink href={slot.href} variant="dark" size="lg">
                <span>
                  {t.cta} <span className="flip-rtl" aria-hidden="true">→</span>
                </span>
              </ButtonLink>
            </>
          ) : (
            <>
              <h3>{t.fallbackCard}</h3>
              <p>{t.fallbackText}</p>
              <ButtonLink href={assistantHref} variant="dark" size="lg">
                <span>
                  {t.fallbackCta} <span className="flip-rtl" aria-hidden="true">→</span>
                </span>
              </ButtonLink>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
