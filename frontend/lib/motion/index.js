import { useEffect, useState } from 'react';

/**
 * Small animation toolkit shared by the home page sections (ported from trial 003).
 * Sections animate by writing styles straight onto elements (through refs) every frame. That is
 * smooth because React doesn't have to re-render anything 60 times a second.
 */

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const easeOut = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const isRtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

/** The mouse position, -1…1 across the screen. One listener for the whole page, shared by everyone. */
export const MOUSE = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      MOUSE.x = (e.clientX / window.innerWidth) * 2 - 1;
      MOUSE.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true },
  );
}

/** Where the journey marker is on screen; the 3D tooth rides it (written by Journey, read by the tooth). */
export const journeyMarker = { x: 0, y: 0 };

/** Event fired once the 3D tooth is built and drawn, so the hero text can start without competing for the CPU. */
export const TOOTH_READY = 'brightsmile:tooth-ready';
/** Remembers that it already happened (Next.js may hide and re-show the page; the event won't fire twice). */
export const toothState = { ready: false };

/* ---------- pinned sections ----------
 * A pinned section is tall (e.g. 300vh) and holds a sticky panel (100vh). While you scroll through
 * it, the panel stays on screen and the animation follows one number: progress 0 → 1. */

/** 0 when the sticky panel locks, 1 when it lets go. */
export function pinProgress(section) {
  const r = section.getBoundingClientRect();
  return clamp(-r.top / (r.height - window.innerHeight));
}

/** The page scroll position at which a pinned section reaches `at` (0…1). */
export function pinY(section, at) {
  return section.getBoundingClientRect().top + window.scrollY + at * (section.offsetHeight - window.innerHeight);
}

/** Where a sticky panel's top edge is on screen, from cached numbers only (cheap enough for every frame). */
export function pinTopScreen(absTop, height) {
  return Math.min(Math.max(absTop - window.scrollY, 0), absTop + height - window.innerHeight - window.scrollY);
}

/* ---------- hooks ---------- */

/**
 * Runs `frame(now)` on every animation frame, but only while `ref`'s element is on screen.
 * Off-screen sections cost nothing. Stops cleanly when the component unmounts or Next.js hides the
 * page (it keeps visited pages alive in the background and runs effect clean-ups when it hides them).
 */
export function useFrameWhileVisible(ref, frame, deps = []) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let running = false;
    let id = 0;
    const tick = (now) => {
      if (!running) return;
      frame(now);
      id = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !running) {
        running = true;
        id = requestAnimationFrame(tick);
      } else if (!entry.isIntersecting) {
        running = false;
        cancelAnimationFrame(id);
      }
    });
    observer.observe(el);
    return () => {
      running = false;
      cancelAnimationFrame(id);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the frame function is rebuilt each render on purpose
  }, deps);
}

/** Calls onIn / onOut when the element enters or leaves the screen. */
export function useWhenVisible(ref, onIn, onOut, threshold = 0.3) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => (entry.isIntersecting ? onIn() : onOut?.()), { threshold });
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- set up once per mount
  }, []);
}

/** True when the visitor asked their device for less motion. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}
