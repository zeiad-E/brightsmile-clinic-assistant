'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useWhenVisible } from '@/lib/motion';
import { FallbackServiceIcon, SERVICE_ICONS } from '@/components/home/icons';
import styles from './Services.module.css';

/**
 * The service cards with the "Who would you like to see?" filter.
 * A client component because the filter remembers a choice (state) and the cards animate in when
 * they scroll into view. The data itself was loaded on the server and arrives as props.
 */
export default function ServiceGrid({ cards, people, t, bookBase, assistantBase }) {
  const [person, setPerson] = useState('all');
  const [shown, setShown] = useState(false);
  const gridRef = useRef(null);
  useWhenVisible(gridRef, () => setShown(true), undefined, 0.05);

  const visible = person === 'all' ? cards : cards.filter((card) => card.people.includes(person));

  // the soft light inside a card follows the pointer
  const spotlight = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };

  return (
    <>
      <div className={styles.toolbar}>
        <div>
          <span className={styles.filterLabel} id="who-filter">
            {t.filterLabel}
          </span>
          <div className={styles.chips} role="group" aria-labelledby="who-filter">
            {[{ id: 'all', name: t.all }, ...people].map((p) => (
              <button key={p.id} type="button" className={styles.chip} aria-pressed={person === p.id} onClick={() => setPerson(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.count} aria-live="polite">
          {t.count.replace('{n}', visible.length)}
        </p>
      </div>

      {cards.length === 0 ? (
        <p className={styles.empty}>{t.empty}</p>
      ) : (
        <div ref={gridRef} className={`${styles.grid} ${shown ? styles.shown : ''}`}>
          {visible.map((card, i) => {
            const Icon = SERVICE_ICONS[card.slug] ?? FallbackServiceIcon;
            return (
              <article key={card.slug} className={styles.card} style={{ '--i': i }} onPointerMove={spotlight}>
                <div className={styles.icon}>
                  <Icon />
                </div>
                <h2>{card.name}</h2>
                <p className={styles.desc}>{card.description}</p>
                <div className={styles.meta}>
                  <span>
                    {card.minutes} {t.min}
                  </span>
                  <span>
                    {t.with} {card.who}
                  </span>
                </div>
                <div className={styles.foot}>
                  <span className={styles.price}>{card.price}</span>
                  <div className={styles.actions}>
                    <Link className={styles.ask} href={`${assistantBase}?q=${encodeURIComponent(t.askPrompt.replace('{service}', card.name))}`}>
                      {t.ask}
                    </Link>
                    <Link className={styles.book} href={`${bookBase}?service=${card.slug}`}>
                      {t.book}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
