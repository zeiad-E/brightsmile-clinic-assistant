'use client';

import Link from 'next/link';
import { useRef } from 'react';
import { prefersReducedMotion } from '@/lib/motion';
import styles from './fx.module.css';

/**
 * The magnetic glowing button from trial 001: it leans towards the mouse, a soft light follows the
 * pointer, and a ripple spreads on click. A link when `href` is given, otherwise a <button>.
 * Touch screens and reduced motion get a normal, still button.
 */
export default function Magnetic({ href, children, dark = false, className = '', onClick, ...props }) {
  const ref = useRef(null);
  const labelRef = useRef(null);

  const move = (e) => {
    const el = ref.current;
    if (e.pointerType !== 'mouse' || prefersReducedMotion()) return;
    const b = el.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2);
    const dy = e.clientY - (b.top + b.height / 2);
    const reach = Math.max(b.width, b.height) * 0.9;
    const pull = Math.max(0, 1 - Math.hypot(dx, dy) / reach);
    el.classList.add(styles.moving);
    el.style.transform = `translate(${dx * 0.3}px, ${dy * 0.3}px)`;
    labelRef.current.style.transform = `translate(${dx * 0.1}px, ${dy * 0.1}px)`;
    el.style.setProperty('--glow', pull.toFixed(2));
    el.style.setProperty('--x', `${e.clientX - b.left}px`);
    el.style.setProperty('--y', `${e.clientY - b.top}px`);
  };
  const rest = () => {
    const el = ref.current;
    el.classList.remove(styles.moving);
    el.style.transform = '';
    labelRef.current.style.transform = '';
    el.style.setProperty('--glow', 0);
  };
  const ripple = (e) => {
    const el = ref.current;
    const b = el.getBoundingClientRect();
    const size = Math.max(b.width, b.height);
    const dot = Object.assign(document.createElement('span'), { className: styles.ripple });
    Object.assign(dot.style, {
      width: `${size}px`,
      height: `${size}px`,
      left: `${(e.clientX || b.left + b.width / 2) - b.left - size / 2}px`,
      top: `${(e.clientY || b.top + b.height / 2) - b.top - size / 2}px`,
    });
    el.append(dot);
    setTimeout(() => dot.remove(), 700);
    onClick?.(e);
  };

  const shared = {
    ref,
    className: `${styles.magnet} ${dark ? styles.dark : ''} ${className}`,
    onClick: ripple,
    children: (
      <span ref={labelRef} className={styles.label}>
        {children}
      </span>
    ),
    ...props,
  };
  return (
    <span className={styles.magnetZone} onPointerMove={move} onPointerLeave={rest}>
      {href ? <Link href={href} {...shared} /> : <button type="button" {...shared} />}
    </span>
  );
}
