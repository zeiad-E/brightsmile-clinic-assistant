'use client';

import { useRef } from 'react';
import { clamp, easeInOut, lerp, pinProgress, useFrameWhileVisible } from '@/lib/motion';
import styles from './Home.module.css';

// The question's route, layer by layer (3 = website on top, 0 = database at the bottom)
const ROUTE = [3, 2, 1, 0, 2, 3];
const zOf = (i, open) => (i * 104 - 156) * open;

/**
 * 8 · Under the hood: the stack of system layers tilts open, then a glowing pulse carries one
 * question down through the layers and back up, while the list on the left says what happens.
 */
export default function UnderTheHood({ t }) {
  const sectionRef = useRef(null);
  const stackRef = useRef(null);
  const pulseRef = useRef(null);
  const beamRef = useRef(null);
  const listRef = useRef(null);
  const statusRef = useRef(null);
  const lastSay = useRef('');

  useFrameWhileVisible(sectionRef, (now) => {
    const section = sectionRef.current;
    const lays = [...stackRef.current.querySelectorAll('[data-layer]')];
    const items = [...listRef.current.children];
    const p = pinProgress(section);
    // 1) open: the stack tilts and the layers lift apart
    const open = easeInOut(clamp(p / 0.26));
    stackRef.current.style.transform = `rotateX(${58 * open}deg) rotateZ(${-38 * open + Math.sin(now / 2400) * 2 * open}deg)`;
    lays.forEach((l, i) => {
      l.style.transform = `translateZ(${zOf(i, open) + Math.sin(now / 1300 + i) * 3 * open}px)`;
    });
    // 2) travel: a glowing pulse visits each stop on the route
    const q = clamp((p - 0.3) / 0.56) * (ROUTE.length - 1);
    const seg = Math.min(ROUTE.length - 2, Math.floor(q)), f = easeInOut(q - seg);
    const z = lerp(zOf(ROUTE[seg], open), zOf(ROUTE[seg + 1], open), f);
    const travelling = p > 0.28 && p < 0.9;
    pulseRef.current.style.opacity = travelling ? 1 : 0;
    beamRef.current.style.opacity = travelling ? 0.85 : 0;
    beamRef.current.style.transform = `rotateX(90deg) scaleY(${open})`; // stands upright, through every layer
    pulseRef.current.style.transform = `translateZ(${z + 16}px) rotateZ(38deg) rotateX(-58deg) scale(${1 + Math.sin(now / 160) * 0.12})`;
    const stop = p < 0.3 ? -1 : ROUTE[Math.round(q)];
    const done = p >= 0.86;
    section.classList.toggle(styles.done, done);
    lays.forEach((l, i) => {
      l.classList.toggle(styles.on, i === stop && !done);
      l.classList.toggle(styles.dim, stop >= 0 && i !== stop && !done);
    });
    items.forEach((li) => li.classList.toggle(styles.on, Number(li.dataset.layer) === stop && !done));
    const say = p < 0.28 ? t.hint : t.say[Math.min(t.say.length - 1, Math.round(q))];
    if (say !== lastSay.current) {
      statusRef.current.textContent = say;
      lastSay.current = say;
    }
  });

  return (
    <section ref={sectionRef} className={styles.stackSec} id="stack">
      <div className={styles.pin} data-pin>
        <div className={`wrap ${styles.stackGrid}`}>
          <div className={styles.secHead}>
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{t.title}</h2>
            <ol ref={listRef} className={styles.layersList}>
              {t.layers.map((layer, i) => (
                <li key={layer.b} data-layer={3 - i}>
                  <b>{layer.b}</b>
                  {layer.text}
                </li>
              ))}
            </ol>
            <div className={styles.stackStatus} aria-live="polite">
              <span className={styles.pulseDot} />
              <span ref={statusRef}>{t.hint}</span>
            </div>
          </div>
          <div className={styles.explode}>
            <div ref={stackRef} className={styles.stack3d}>
              <div className={`${styles.lay} ${styles.layDb}`} data-layer="0">
                <span className={styles.tag}>{t.tags[0]}</span>
                <div className={styles.cal}>
                  {['', 'b', '', 'b', '', 'b', '', '', 'b', '', '', 'slot', '', 'b', ''].map((kind, i) => (
                    <i key={i} className={kind ? styles[kind] : undefined} />
                  ))}
                </div>
              </div>
              <div className={`${styles.lay} ${styles.layRag}`} data-layer="1">
                <span className={styles.tag}>{t.tags[1]}</span>
                <div className={styles.docs}>
                  {[0, 1, 2].map((d) => (
                    <div key={d} className={styles.doc}>
                      <i />
                      <i />
                      <i />
                    </div>
                  ))}
                </div>
              </div>
              <div className={`${styles.lay} ${styles.layAi}`} data-layer="2">
                <span className={styles.tag}>{t.tags[2]}</span>
                <svg className={styles.graph} viewBox="0 0 300 160" aria-hidden="true">
                  <path d="M60 110 L130 50 L210 90 L250 40 M130 50 L150 125 L210 90 M60 110 L150 125" />
                  <circle cx="60" cy="110" r="9" />
                  <circle cx="130" cy="50" r="9" />
                  <circle cx="210" cy="90" r="9" />
                  <circle cx="250" cy="40" r="7" />
                  <circle cx="150" cy="125" r="7" />
                </svg>
              </div>
              <div className={`${styles.lay} ${styles.layUi}`} data-layer="3">
                <span className={styles.tag}>{t.tags[3]}</span>
                <div className={styles.uiBub}>{t.uiAsk}</div>
                <div className={`${styles.uiBub} ${styles.bot}`}>{t.uiAnswer}</div>
                <div className={styles.uiBtn}>{t.uiBook}</div>
              </div>
              <div ref={beamRef} className={styles.beam} />
              <div ref={pulseRef} className={styles.pulse} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
