'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { clamp, lerp, pinProgress, prefersReducedMotion } from '@/lib/motion';

/**
 * Page-wide effects for the home page only:
 *  - the 3D tooth, loaded lazily and only in the browser (it is the heaviest code on the site);
 *  - smooth, inertial mouse-wheel scrolling (as in trial 003);
 *  - the site header turns dark while it sits over a dark section.
 * Each one is undone in its clean-up, so other pages behave normally.
 */
const ToothCompanion = dynamic(() => import('./tooth/ToothCompanion'), { ssr: false });

export default function HomeEffects() {
  useSmoothWheel();
  useDarkHeader();
  return <ToothCompanion />;
}

/** The wheel moves a target; the page glides toward it every frame (easing 8.5% of the gap per frame). */
function useSmoothWheel() {
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let target = window.scrollY, current = window.scrollY, running = false, id = 0;
    const max = () => document.documentElement.scrollHeight - window.innerHeight;
    const tick = () => {
      current = lerp(current, target, 0.085);
      if (Math.abs(target - current) < 0.4) {
        current = target;
        running = false;
      }
      window.scrollTo(0, current);
      if (running) id = requestAnimationFrame(tick);
    };
    const onWheel = (e) => {
      if (e.ctrlKey) return; // pinch-zoom on a trackpad
      e.preventDefault();
      target = clamp(target + e.deltaY * (e.deltaMode === 1 ? 40 : 1), 0, max());
      if (!running) {
        running = true;
        id = requestAnimationFrame(tick);
      }
    };
    // Scrolling by other means (keyboard, scrollbar, touch) resets the glide to wherever the page is.
    const onScroll = () => {
      if (!running) target = current = window.scrollY;
    };
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
}

/** Dark header over the services and X-ray sections, and while the portal is still dark. */
function useDarkHeader() {
  useEffect(() => {
    const header = document.querySelector('[data-site-header]');
    if (!header) return;
    const update = () => {
      const portal = document.getElementById('portal');
      const overDark = ['services', 'xray'].some((id) => {
        const r = document.getElementById(id)?.getBoundingClientRect();
        return r && r.top < 40 && r.bottom > 40;
      });
      const portalDark = portal && portal.getBoundingClientRect().top < 40 && pinProgress(portal) < 0.55;
      header.dataset.tone = overDark || portalDark ? 'dark' : 'light';
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update);
      delete header.dataset.tone;
    };
  }, []);
}
