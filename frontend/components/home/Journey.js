'use client';

import { useEffect, useRef, useState } from 'react';
import { clamp, journeyMarker, lerp, pinProgress, pinTopScreen, useFrameWhileVisible } from '@/lib/motion';
import styles from './Home.module.css';

const D = 'M300 70 C 520 170, 520 330, 300 420 S 80 660, 300 750 S 520 990, 300 1080 S 80 1320, 300 1410 L 300 1530';
const STOP_AT = [0.06, 0.29, 0.52, 0.75, 0.97]; // where each stop sits along the path (0…1)

/**
 * 6 · Journey: a winding path draws itself as you scroll; stops light up as it reaches them, and the
 * 3D tooth rides the marker at its tip.
 */
export default function Journey({ t }) {
  const sectionRef = useRef(null);
  const pinRef = useRef(null);
  const windowRef = useRef(null);
  const svgRef = useRef(null);
  const progRef = useRef(null);
  const markerRef = useRef(null);
  const nodesRef = useRef(null);
  const [points, setPoints] = useState(null); // where each stop is on the path (needs the browser to measure)
  const geo = useRef({});
  const pan = useRef(0);

  useEffect(() => {
    const prog = progRef.current;
    const len = prog.getTotalLength();
    prog.style.strokeDasharray = len;
    setPoints(STOP_AT.map((f) => prog.getPointAtLength(len * f)));

    // Measure once (and on resize) so the frame loop never has to read layout.
    const measure = () => {
      const sr = sectionRef.current.getBoundingClientRect();
      const pr = pinRef.current.getBoundingClientRect();
      const wr = windowRef.current.getBoundingClientRect();
      const br = svgRef.current.getBoundingClientRect();
      Object.assign(geo.current, {
        len,
        absTop: sr.top + window.scrollY,
        height: sectionRef.current.offsetHeight,
        winTop: wr.top - pr.top,
        winH: wr.height,
        svgLeft: br.left,
        k: br.width / 600,
        svgH: br.height,
      });
    };
    measure();
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useFrameWhileVisible(sectionRef, () => {
    const g = geo.current;
    if (!g.len) return;
    const p = clamp(pinProgress(sectionRef.current) * 1.06);
    progRef.current.style.strokeDashoffset = g.len * (1 - p);
    const pt = progRef.current.getPointAtLength(g.len * p);
    markerRef.current.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
    [...(nodesRef.current?.children ?? [])].forEach((node, i) => node.classList.toggle(styles.on, p >= STOP_AT[i] - 0.005));
    pan.current = lerp(pan.current, clamp(pt.y * g.k - g.winH / 2, 0, Math.max(0, g.svgH - g.winH)), 0.14);
    svgRef.current.style.transform = `translateY(${-pan.current}px)`;
    journeyMarker.x = g.svgLeft + pt.x * g.k;
    journeyMarker.y = pinTopScreen(g.absTop, g.height) + g.winTop + pt.y * g.k - pan.current;
  });

  return (
    <section ref={sectionRef} className={styles.journey} id="how">
      <div ref={pinRef} className={styles.pin} data-pin>
        <div className={`wrap ${styles.journeyGrid}`}>
          <div className={styles.secHead}>
            <div className="eyebrow">{t.eyebrow}</div>
            <h2>{t.title}</h2>
            <p>{t.text}</p>
          </div>
          <div ref={windowRef} className={styles.journeyWindow}>
            {/* direction="ltr": the drawing's labels are placed by coordinates, so they mustn't flip in Arabic */}
            <svg ref={svgRef} className={styles.jr} viewBox="0 0 600 1600" direction="ltr" aria-hidden="true">
              <path className={styles.base} d={D} />
              <path ref={progRef} className={styles.prog} d={D} />
              <g ref={nodesRef}>
                {points?.map((pt, i) => {
                  const right = pt.x <= 300;
                  const lx = right ? pt.x + 40 : pt.x - 40;
                  const anchor = right ? 'start' : 'end';
                  const [title, sub] = t.stops[i];
                  return (
                    <g key={i} className={styles.node}>
                      <circle cx={pt.x} cy={pt.y} r="12" />
                      <text className={styles.t} x={lx} y={pt.y - 4} textAnchor={anchor}>{title}</text>
                      <text className={styles.s} x={lx} y={pt.y + 20} textAnchor={anchor}>{sub}</text>
                    </g>
                  );
                })}
              </g>
              <g ref={markerRef} className={styles.marker}>
                <circle r="30" />
              </g>
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
