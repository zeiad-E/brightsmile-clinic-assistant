'use client';

import { useEffect, useRef } from 'react';
import { lerp, useFrameWhileVisible } from '@/lib/motion';
import { TOOTH_D } from './icons';
import styles from './Home.module.css';

// geometry of the six teeth in the drawing (viewBox 1000 × 500)
const XS = [175, 305, 435, 565, 695, 825];
const S = 0.62;
const TOP = 150;
const GUM = 'M0 600 L0 238 L110 238 ' + XS.map((x) => `Q${x} 292 ${x + 65} 238`).join(' ') + ' L1000 238 L1000 600 Z';
const toothAt = (x) => `translate(${x - 100 * S} ${TOP}) scale(${S})`;
const pulpAt = (x) => `translate(${x - 100 * S * 0.5} ${TOP + 38}) scale(${S * 0.5} ${S * 0.72})`;

/**
 * 5 · X-ray: a healthy-looking smile; a lens follows the pointer and shows what the dentist sees.
 * When the pointer is away, the lens drifts on its own. The two drawings are stacked; the X-ray one
 * is only visible inside a circle (a CSS mask) that moves with the lens.
 */
export default function XRay({ t }) {
  const stageRef = useRef(null);
  const lensRef = useRef(null);
  const pointer = useRef({ tx: 0, ty: 0, x: 0, y: 0, inside: false });

  useEffect(() => {
    const stage = stageRef.current;
    const move = (e) => {
      const r = stage.getBoundingClientRect();
      Object.assign(pointer.current, { tx: e.clientX - r.left, ty: e.clientY - r.top, inside: true });
    };
    const leave = () => {
      pointer.current.inside = false;
    };
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerleave', leave);
    return () => {
      stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerleave', leave);
    };
  }, []);

  useFrameWhileVisible(stageRef, (now) => {
    const stage = stageRef.current;
    const p = pointer.current;
    const w = stage.clientWidth, h = stage.clientHeight, R = w < 520 ? 84 : 130;
    if (!p.inside) {
      p.tx = w / 2 + Math.sin(now / 1500) * w * 0.33;
      p.ty = h * 0.45 + Math.sin(now / 1100) * h * 0.12;
    }
    p.x = lerp(p.x, p.tx, 0.14);
    p.y = lerp(p.y, p.ty, 0.14);
    stage.style.setProperty('--x', `${p.x}px`);
    stage.style.setProperty('--y', `${p.y}px`);
    stage.style.setProperty('--r', `${R}px`);
    lensRef.current.style.transform = `translate(${p.x - R}px, ${p.y - R}px)`;
  });

  return (
    <section className={styles.xraySec} id="xray">
      <div className="wrap">
        <div className={`${styles.secHead} ${styles.center}`}>
          <div className={`eyebrow ${styles.light}`}>{t.eyebrow}</div>
          <h2>{t.title}</h2>
          <p>{t.text}</p>
        </div>
        <div ref={stageRef} className={styles.xray}>
          <div className={styles.xrLayer}>
            <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" direction="ltr" aria-hidden="true">
              <defs>
                <linearGradient id="smBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e6faf7" /><stop offset="1" stopColor="#fff" /></linearGradient>
                <linearGradient id="smTooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" /><stop offset="1" stopColor="#e3f1ef" /></linearGradient>
                <linearGradient id="smGum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#bdeee6" /><stop offset="1" stopColor="#8fd8cb" /></linearGradient>
              </defs>
              <rect x="-200" y="-200" width="1400" height="900" fill="url(#smBg)" />
              <text x="500" y="92" textAnchor="middle" style={{ fontFamily: "var(--font-sans)" }} fontWeight="750" fontSize="40" fill="#0b2545">{t.smileTitle}</text>
              {XS.map((x) => (
                <path key={x} d={TOOTH_D} transform={toothAt(x)} fill="url(#smTooth)" stroke="#cfe9e5" strokeWidth="5" />
              ))}
              <path d={GUM} fill="url(#smGum)" />
            </svg>
          </div>
          <div className={`${styles.xrLayer} ${styles.xrRay}`}>
            <svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice" direction="ltr" aria-hidden="true">
              <defs>
                <radialGradient id="xrBg" cx=".5" cy=".45" r=".75"><stop offset="0" stopColor="#1b2838" /><stop offset="1" stopColor="#05080d" /></radialGradient>
                <linearGradient id="xrTooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#f1f6fb" /><stop offset=".55" stopColor="#b6c4d3" /><stop offset="1" stopColor="#7c8b9e" /></linearGradient>
                <filter id="xrGlow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                <filter id="xrSoft"><feGaussianBlur stdDeviation="2.5" /></filter>
                <pattern id="xrScan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="rgba(255,255,255,.05)" /></pattern>
              </defs>
              <rect x="-200" y="-200" width="1400" height="900" fill="url(#xrBg)" />
              <text x="500" y="92" textAnchor="middle" style={{ fontFamily: "var(--font-sans)" }} fontWeight="750" fontSize="40" fill="#5eead4">{t.rayTitle}</text>
              <path d={GUM} fill="#3a4a5e" opacity=".55" />
              <g filter="url(#xrGlow)" opacity=".93">
                {XS.map((x) => (
                  <path key={x} d={TOOTH_D} transform={toothAt(x)} fill="url(#xrTooth)" stroke="rgba(255,255,255,.55)" strokeWidth="3" />
                ))}
              </g>
              {XS.map((x, i) =>
                i === 3 ? (
                  <path key={x} d={TOOTH_D} transform={pulpAt(x)} fill="#ffffff" filter="url(#xrGlow)" />
                ) : (
                  <path key={x} d={TOOTH_D} transform={pulpAt(x)} fill="#253244" />
                ),
              )}
              <ellipse cx={XS[1] + 18} cy={TOP + 40} rx="15" ry="10" fill="#070b11" filter="url(#xrSoft)" />
              <rect x={XS[4] - 26} y={TOP + 22} width="52" height="26" rx="12" fill="#fff" filter="url(#xrGlow)" />
              <g style={{ fontFamily: "var(--font-mono)" }} fontSize="21" fill="#5eead4">
                <path d={`M${XS[1] + 30} ${TOP + 34} L${XS[1] + 70} 128`} stroke="#5eead4" strokeWidth="2" />
                <text x={XS[1] + 76} y="124">{t.cavity}</text>
                <path d={`M${XS[4] + 24} ${TOP + 30} L${XS[4] + 64} 128`} stroke="#5eead4" strokeWidth="2" />
                <text x={XS[4] + 70} y="124">{t.filling}</text>
                <path d={`M${XS[3]} ${TOP + 150} L${XS[3]} 430`} stroke="#5eead4" strokeWidth="2" />
                <text x={XS[3]} y="458" textAnchor="middle">{t.root}</text>
              </g>
              <rect x="-200" y="-200" width="1400" height="900" fill="url(#xrScan)" />
            </svg>
          </div>
          <div ref={lensRef} className={styles.xrLens}>
            <span>{t.lens}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
