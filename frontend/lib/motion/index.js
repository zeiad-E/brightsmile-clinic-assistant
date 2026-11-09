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

/** The mouse position, -1…1 across the screen. One listener for the whole page, shared by everyone.
 *  Fingers don't count: a touch that starts a scroll would yank the tooth toward the thumb. */
export const MOUSE = { x: 0, y: 0 };
if (typeof window !== 'undefined') {
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      MOUSE.x = (e.clientX / window.innerWidth) * 2 - 1;
      MOUSE.y = (e.clientY / window.innerHeight) * 2 - 1;
    },
    { passive: true },
  );
}

/** Where the journey marker is on screen; the 3D tooth rides it (written by Journey, read by the tooth). */
export const journeyMarker = { x: 0, y: 0 };

/** The Blender molar. Named here so HomeEffects can ask for it early without loading the tooth's code. */
export const MODEL_URL = '/models/molar.glb';
/** Remembers that the tooth already assembled once (Next.js may hide and re-show the page). */
export const toothState = { shown: false };

/* ---------- scrolling on phones ----------
 * A phone scrolls the page on its own fast lane (the "compositor"), separately from our JavaScript.
 * Our animations read window.scrollY once per frame, and on a phone that number arrives late and
 * unevenly (and an iPhone 13 Pro scrolls at 120 frames a second while Safari runs our code at 60).
 * Anything drawn straight from it shakes: that was the molar "vibrating". So on touch screens every
 * scroll animation follows a smoothed copy of the scroll position instead: each frame it moves part of
 * the way toward the real one, like a camera on a soft spring. With a mouse nothing changes (the home
 * page already glides the wheel itself). */
const SMOOTH_MS = 55; // how soft the spring is: bigger = smoother but a little more behind
const smoothScroll =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const scroll = { y: 0, t: -1 };

/** Call once per frame with the frame's time; every loop in the same frame gets the same answer. */
export function tickScroll(now) {
  if (now === scroll.t) return scroll.y;
  const y = window.scrollY;
  const dt = now - scroll.t;
  if (!smoothScroll || scroll.t < 0 || dt > 100) {
    scroll.y = y; // first frame, or after a pause: start from where the page really is
  } else {
    scroll.y += (y - scroll.y) * (1 - Math.exp(-dt / SMOOTH_MS)); // the same softness at 60 or 120 frames a second
    if (Math.abs(y - scroll.y) < 0.3) scroll.y = y;
  }
  scroll.t = now;
  return scroll.y;
}

/** The scroll position animations should use right now (the smoothed one while frames are running). */
export const scrollPos = () => (scroll.t >= 0 && performance.now() - scroll.t < 100 ? scroll.y : window.scrollY);

/* The height of 100vh in pixels. A pinned panel is 100vh tall, so this is how long it stays pinned.
 * window.innerHeight would be wrong on a phone: it changes every time Safari's bar slides in or out,
 * which made the animations (and the molar) jump a little mid-scroll. 100vh doesn't move. */
let vhProbe = null;
let vhDirty = true;
let vhValue = 0;
if (typeof window !== 'undefined') window.addEventListener('resize', () => (vhDirty = true), { passive: true });
export function viewportH() {
  if (vhDirty) {
    if (!vhProbe) {
      vhProbe = document.createElement('div');
      vhProbe.setAttribute('aria-hidden', 'true');
      vhProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100vh;visibility:hidden;pointer-events:none';
      document.body.appendChild(vhProbe);
    }
    vhValue = vhProbe.offsetHeight || window.innerHeight;
    vhDirty = false;
  }
  return vhValue;
}

/* ---------- pinned sections ----------
 * A pinned section is tall (e.g. 300vh) and holds a sticky panel (100vh). While you scroll through
 * it, the panel stays on screen and the animation follows one number: progress 0 → 1. */

/** 0 when the sticky panel locks, 1 when it lets go. */
export function pinProgress(section) {
  const r = section.getBoundingClientRect();
  const top = r.top + window.scrollY - scrollPos(); // where the section would be at the smoothed scroll
  return clamp(-top / (r.height - viewportH()));
}

/** The page scroll position at which a pinned section reaches `at` (0…1). */
export function pinY(section, at) {
  return section.getBoundingClientRect().top + window.scrollY + at * (section.offsetHeight - viewportH());
}

/** Where a sticky panel's top edge is on screen, from cached numbers only (cheap enough for every frame). */
export function pinTopScreen(absTop, height, y = scrollPos()) {
  return Math.min(Math.max(absTop - y, 0), absTop + height - viewportH() - y);
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
      tickScroll(now);
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
