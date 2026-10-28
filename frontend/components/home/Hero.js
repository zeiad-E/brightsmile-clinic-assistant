'use client';

import { useEffect, useRef, useState } from 'react';
import { MOUSE, TOOTH_READY, lerp, toothState, useFrameWhileVisible, prefersReducedMotion, wait } from '@/lib/motion';
import ButtonLink from '@/components/ui/ButtonLink';
import { Brush, Floss } from './icons';
import SplitText from './SplitText';
import styles from './Home.module.css';

const cx = (...names) => names.filter(Boolean).join(' ');

/**
 * 1 · Hero: the whole section is the scene. Depth layers follow the mouse, the headline types in
 * letter by letter, then the second line keeps swapping phrases. The 3D tooth stands in the spot.
 */
export default function Hero({ t, arabic, eyebrow, nextSlot, bookHref, askHref }) {
  const heroRef = useRef(null);
  const bgRef = useRef(null);
  const sceneRef = useRef(null);
  // The phrases on the second line: [{ key, index, leaving, overlap }]. The old phrase keeps its key
  // while it slides out, so React keeps the same element and the CSS transition can play.
  const [words, setWords] = useState([]);
  const wordKey = useRef(0);

  /* the opening sequence: eyebrow → "Your smile," letter by letter → phrase → paragraph → buttons */
  useEffect(() => {
    const hero = heroRef.current;
    const letters = [...hero.querySelectorAll(`.${styles.hLine} .${styles.c}`)];
    let cancelled = false;
    let rotateTimer = 0;
    let n = 0;

    const show = (index) => {
      const key = ++wordKey.current;
      setWords((current) => [
        ...current.map((w) => ({ ...w, leaving: true })),
        { key, index, leaving: false, overlap: current.length > 0 },
      ]);
      setTimeout(() => !cancelled && setWords((current) => current.filter((w) => !w.leaving)), 500);
    };
    const next = () => {
      n = (n + 1) % t.phrases.length;
      show(n);
    };

    async function play() {
      hero.classList.add(styles.in);
      if (prefersReducedMotion()) {
        letters.forEach((c) => c.classList.add(styles.on));
        show(0);
        hero.classList.add(styles.showLead, styles.showCta);
        return;
      }
      await wait(450);
      // timed by animation frames: each letter waits 50 ms after the previous one really appeared
      await new Promise((done) => {
        let i = 0, due = 0;
        (function step(now) {
          if (cancelled) return done();
          if (now >= due) {
            letters[i++]?.classList.add(styles.on);
            due = now + 50;
          }
          if (i < letters.length) requestAnimationFrame(step);
          else done();
        })(performance.now());
      });
      if (cancelled) return;
      await wait(350);
      show(0);
      await wait(t.phrases[0].length * 60 + 450);
      if (cancelled) return;
      hero.classList.add(styles.showLead);
      await wait(400);
      hero.classList.add(styles.showCta);
      await wait(3200);
      if (!cancelled) rotateTimer = setInterval(next, 3600);
    }

    // Start once the 3D tooth is built and drawn, so no heavy work runs while letters type; 2.5 s at the latest.
    let started = false;
    const go = () => {
      if (started || cancelled) return;
      started = true;
      play();
    };
    if (toothState.ready) go();
    window.addEventListener(TOOTH_READY, go, { once: true });
    const fallback = setTimeout(go, 2500);

    return () => {
      cancelled = true;
      clearTimeout(fallback);
      clearInterval(rotateTimer);
      window.removeEventListener(TOOTH_READY, go);
    };
  }, [t.phrases]);

  /* depth layers follow the mouse (or drift slowly when the mouse is still) */
  const tilt = useRef({ x: 0, y: 0 });
  useFrameWhileVisible(bgRef, (now) => {
    const reduced = prefersReducedMotion();
    const idle = !reduced && Math.abs(MOUSE.x) + Math.abs(MOUSE.y) < 0.001;
    const tx = idle ? Math.sin(now / 1400) * 0.5 : MOUSE.x;
    const ty = idle ? Math.cos(now / 1100) * 0.35 : MOUSE.y;
    const c = tilt.current;
    c.x = lerp(c.x, tx, 0.06);
    c.y = lerp(c.y, ty, 0.06);
    sceneRef.current.style.transform = `rotateY(${c.x * 6}deg) rotateX(${-c.y * 6}deg)`;
    for (const layer of sceneRef.current.children) {
      const d = Number(layer.dataset.depth);
      layer.style.transform = `translate3d(${c.x * d * 30}px, ${c.y * d * 22}px, 0)`;
    }
  });

  return (
    <section ref={heroRef} className={styles.hero} id="top">
      <div ref={bgRef} className={styles.heroBg} aria-hidden="true">
        <div ref={sceneRef} className={styles.depthScene}>
          <div className={styles.layer} data-depth="0.12">
            <div className={styles.blob} style={{ left: '38%', top: '-6%', width: '52%', height: '70%', background: '#a7f3e4' }} />
            <div className={styles.blob} style={{ right: '-8%', top: '30%', width: '40%', height: '62%', background: '#bfe3ff' }} />
            <div className={styles.blob} style={{ left: '-10%', bottom: '-20%', width: '40%', height: '50%', background: '#d9f7f1' }} />
          </div>
          <div className={styles.layer} data-depth="0.3">
            <div className={styles.ring} style={{ left: '58%', top: '12%', width: '46vh', height: '46vh' }} />
            <div className={styles.bubble} style={{ left: '52%', top: '18%', width: 40, height: 40 }} />
            <div className={styles.bubble} style={{ right: '9%', top: '14%', width: 26, height: 26 }} />
            <div className={styles.bubble} style={{ left: '6%', top: '22%', width: 18, height: 18 }} />
          </div>
          <div className={styles.layer} data-depth="0.6">
            <span className={styles.floss}>
              <Floss />
            </span>
            <div className={styles.bubble} style={{ right: '30%', bottom: '16%', width: 22, height: 22 }} />
          </div>
          <div className={styles.layer} data-depth="1.1">
            <span className={styles.brush}>
              <Brush />
            </span>
          </div>
          <div className={styles.layer} data-depth="1.7" style={{ filter: 'blur(4px)' }}>
            <div className={styles.bubble} style={{ left: '44%', bottom: '6%', width: 80, height: 80 }} />
            <div className={styles.bubble} style={{ right: '3%', top: '8%', width: 60, height: 60 }} />
          </div>
        </div>
      </div>

      <div className={cx(styles.spot, styles.spotHero)} data-spot="hero" />

      <div className={cx('wrap', styles.heroGrid)}>
        <div className={styles.heroCopy}>
          <div className="eyebrow">{eyebrow}</div>
          <h1>
            <span className={styles.hLine}>
              <SplitText text={t.titleA} arabic={arabic} />
            </span>
            <span className={styles.rotator}>
              {words.map((w) => (
                <RotWord key={w.key} text={t.phrases[w.index]} arabic={arabic} leaving={w.leaving} overlap={w.overlap} />
              ))}
            </span>
          </h1>
          <p className={styles.lead}>{t.lead}</p>
          <div className={styles.ctaRow}>
            <ButtonLink href={bookHref} variant="mint" size="lg">
              <span>
                {t.book} <span className="flip-rtl" aria-hidden="true">→</span>
              </span>
            </ButtonLink>
            <ButtonLink href={askHref} variant="ghost" size="lg">
              {t.ask}
            </ButtonLink>
          </div>
        </div>
      </div>

      {nextSlot && (
        <div className={styles.slotChip}>
          <span className={styles.dot} />
          {t.nextFree} <b>{nextSlot}</b>
        </div>
      )}
      <div className={styles.scrollCue} aria-hidden="true">
        <span>{t.scroll}</span>
        <i />
      </div>
    </section>
  );
}

/**
 * One phrase of the rotating second line: letters rise in, then rise out when the next one arrives.
 * While the old phrase leaves, the new one sits on the same line (negative margin) for half a second.
 */
function RotWord({ text, arabic, leaving, overlap }) {
  const [shown, setShown] = useState(false);
  const [sitOnLine, setSitOnLine] = useState(overlap);
  useEffect(() => {
    // two frames later, so the browser has drawn the letters below the line before they rise
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setShown(true));
    });
    const timer = setTimeout(() => setSitOnLine(false), 520);
    return () => {
      cancelAnimationFrame(id);
      clearTimeout(timer);
    };
  }, []);
  return (
    <span
      className={cx(styles.rotWord, (shown || leaving) && styles.show, leaving && styles.leave)}
      style={sitOnLine ? { marginTop: 'calc(-1 * var(--rot-line))' } : undefined}
    >
      <SplitText text={text} arabic={arabic} />
    </span>
  );
}
