// BrightSmile home journey: sections, scroll effects and shared helpers. The 3D tooth lives in companion.js.

// Testing aid: ?raf=timer drives animation with a timer, for background tabs that pause animation frames.
if (location.search.includes('raf=timer')) window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOUSE = { x: 0, y: 0 }; // -1…1 across the viewport, shared with the tooth
addEventListener('pointermove', e => { MOUSE.x = e.clientX / innerWidth * 2 - 1; MOUSE.y = e.clientY / innerHeight * 2 - 1; }, { passive: true });

// The one scroll value for a pinned section: 0 when its sticky panel locks, 1 when it lets go.
const pinProgress = section => { const r = section.getBoundingClientRect(); return clamp(-r.top / (r.height - innerHeight)); };
// The page scroll position at which a pinned section reaches `at` (0…1).
const pinY = (section, at) => section.getBoundingClientRect().top + scrollY + at * (section.offsetHeight - innerHeight);
// Where a sticky panel's top edge is on screen right now, from the section's cached page position and height.
// (Pure maths, no layout reads, so it is cheap to call every frame.)
const pinTopScreen = (absTop, height) => Math.min(Math.max(absTop - scrollY, 0), absTop + height - innerHeight - scrollY);

/* ---------- clinic data (from supabase/seed.sql) ---------- */
const SERVICES = [
  { name: 'Check-up & consultation', min: 20, price: 400, who: 'Dr. Sarah · Dr. Karim', icon: 'search' },
  { name: 'Teeth cleaning', min: 30, price: 800, who: 'Nadia Fawzy', icon: 'sparkle' },
  { name: 'Tooth filling', min: 45, price: 1200, who: 'Dr. Sarah · Dr. Karim', icon: 'shield' },
  { name: 'Tooth extraction', min: 30, price: 1000, who: 'Dr. Karim Adel', icon: 'extract' },
  { name: 'Root canal treatment', min: 90, price: 3500, who: 'Dr. Sarah Mansour', icon: 'pulse' },
  { name: 'Teeth whitening', min: 60, price: 4500, who: 'Dr. Sarah Mansour', icon: 'smile' },
  { name: "Children's check-up", min: 30, price: 500, who: 'Dr. Karim · Nadia', icon: 'kids' },
  { name: 'Braces consultation', min: 30, price: 500, who: 'Dr. Sarah Mansour', icon: 'braces' },
];
const egp = n => n.toLocaleString('en-US') + ' EGP';

/* ---------- drawings ---------- */
const TOOTH_D = 'M40 30 C60 5 85 20 100 22 C115 20 140 5 160 30 C182 58 175 105 160 130 C150 150 148 175 142 205 C138 225 122 232 116 210 C110 185 106 165 100 165 C94 165 90 185 84 210 C78 232 62 225 58 205 C52 175 50 150 40 130 C25 105 18 58 40 30 Z';
const line = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  toothSolid: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#14b8a6"/></svg>`,
  toothSolidWhite: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#fff"/></svg>`,
  smile: () => line('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>'),
  sparkle: () => line('<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>'),
  shield: () => line('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  pulse: () => line('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
  extract: () => line('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  kids: () => line('<circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-6 7-6s7 2 7 6"/>'),
  braces: () => line('<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M7.5 9v6M12 9v6M16.5 9v6"/>'),
  search: () => line('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>'),
  mascot: () => `<svg viewBox="0 0 200 240" style="width:100%;height:100%"><path d="${TOOTH_D}" fill="#fff" stroke="#bfe9e2" stroke-width="5"/>
    <ellipse cx="76" cy="104" rx="9" ry="12" fill="#0b2545"/><ellipse cx="124" cy="104" rx="9" ry="12" fill="#0b2545"/>
    <path d="M82 132 Q100 152 118 132" stroke="#0b2545" stroke-width="6" fill="none" stroke-linecap="round"/></svg>`,
  brush: () => {
    const b = Array.from({ length: 9 }, (_, i) => `<rect x="${204 + i * 9.5}" y="2" width="6" height="22" rx="3" fill="${i % 2 ? '#5eead4' : '#fff'}" stroke="#bfe9e2"/>`).join('');
    return `<svg viewBox="0 0 300 60"><rect x="0" y="26" width="196" height="16" rx="8" fill="#14b8a6"/>
      <rect x="22" y="30" width="60" height="8" rx="4" fill="#0f766e" opacity=".45"/>
      <rect x="190" y="22" width="102" height="20" rx="8" fill="#fff" stroke="#bfe9e2" stroke-width="2"/>${b}</svg>`;
  },
  floss: () => `<svg viewBox="0 0 100 120"><rect x="10" y="30" width="80" height="80" rx="18" fill="#fff" stroke="#bfe9e2" stroke-width="3"/>
    <rect x="10" y="30" width="80" height="22" rx="11" fill="#14b8a6"/><path d="M50 30 C50 10 70 8 86 2" stroke="#0f766e" stroke-width="2" fill="none"/>
    <circle cx="50" cy="80" r="14" fill="#e6faf7"/></svg>`,
};
$$('[data-icon]').forEach(el => { el.innerHTML = ICONS[el.dataset.icon](el); });

/* ---------- helpers ---------- */
function whenVisible(el, onIn, onOut, threshold = 0.3) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? onIn() : onOut && onOut()), { threshold }).observe(el);
}
function loopWhileVisible(el, frame) {
  let running = false;
  const tick = now => { if (running) { frame(now); requestAnimationFrame(tick); } };
  whenVisible(el, () => { if (!running) { running = true; requestAnimationFrame(tick); } }, () => { running = false; }, 0);
}
// Splits text into one span per letter (inside one span per word) so letters can animate.
function splitLetters(el) {
  let i = 0;
  const walk = node => [...node.childNodes].forEach(n => {
    if (n.nodeType !== 3) return walk(n);
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) return frag.append(' ');
      const w = Object.assign(document.createElement('span'), { className: 'w' });
      [...part].forEach(ch => {
        const c = Object.assign(document.createElement('span'), { className: 'c', textContent: ch });
        c.style.setProperty('--i', i++);
        w.append(c);
      });
      frag.append(w);
    });
    n.replaceWith(frag);
  });
  walk(el);
}

/* ---------- smooth inertial scroll ---------- */
const smooth = (() => {
  let target = scrollY, current = scrollY, running = false;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const tick = () => {
    current = lerp(current, target, .085);
    if (Math.abs(target - current) < .4) { current = target; running = false; }
    window.scrollTo(0, current);
    if (running) requestAnimationFrame(tick);
  };
  const start = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
  if (!REDUCED) addEventListener('wheel', e => {
    if (e.ctrlKey) return;
    e.preventDefault();
    target = clamp(target + e.deltaY * (e.deltaMode === 1 ? 40 : 1), 0, max());
    start();
  }, { passive: false });
  addEventListener('scroll', () => { if (!running) target = current = scrollY; });
  return { to(y) { target = clamp(y, 0, max()); current = scrollY; if (REDUCED) window.scrollTo(0, target); else start(); } };
})();
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"]');
  if (!a) return;
  const id = a.getAttribute('href');
  e.preventDefault();
  smooth.to(id === '#top' ? 0 : $(id).getBoundingClientRect().top + scrollY);
});


/* ---------- nav turns dark over dark sections ---------- */
const nav = $('.nav');
function updateNav() {
  const p = pinProgress($('#portal'));
  const overDark = ['#services', '#xray-sec'].some(sel => { const r = $(sel).getBoundingClientRect(); return r.top < 40 && r.bottom > 40; });
  const portalTop = $('#portal').getBoundingClientRect().top;
  nav.classList.toggle('dark', overDark || (portalTop < 40 && p < .55));
}
addEventListener('scroll', updateNav, { passive: true });

/* ========== 1 · hero text: letters rise, then the second line cycles phrases ========== */
(() => {
  const hero = $('.hero');
  splitLetters($('.h-line', hero));
  const slot = $('.rotator', hero);
  const PHRASES = ['our priority.', 'in good hands.', 'booked fast.', 'bright again.'];
  let n = 0;
  const show = text => {
    const w = Object.assign(document.createElement('span'), { className: 'rot-word', textContent: text });
    splitLetters(w);
    slot.append(w);
    requestAnimationFrame(() => requestAnimationFrame(() => w.classList.add('show')));
    return w;
  };
  slot.textContent = '';
  let current;
  const letters = $$('.h-line .c', hero);
  // One step at a time, each step waiting for the one before: eyebrow → "Your smile," letter by letter →
  // the phrase → paragraph → buttons → phrases start rotating. A pause in the browser just delays the next step.
  async function play() {
    hero.classList.add('in');
    if (REDUCED) {
      letters.forEach(c => c.classList.add('on')); current = show(PHRASES[0]);
      hero.classList.add('show-lead', 'show-cta'); return;
    }
    await wait(450);
    // timed by animation frames: each letter waits 50 ms after the previous one really appeared, so the rhythm stays even
    await new Promise(done => {
      let i = 0, due = 0;
      (function step(now) {
        if (now >= due) { letters[i++].classList.add('on'); due = now + 50; }
        if (i < letters.length) requestAnimationFrame(step); else done();
      })(performance.now());
    });
    await wait(350);
    current = show(PHRASES[0]);
    await wait(PHRASES[0].length * 60 + 450);
    hero.classList.add('show-lead');
    await wait(400);
    hero.classList.add('show-cta');
    await wait(3200);
    setInterval(next, 3600);
  }
  // start once the 3D tooth is built and drawn (companion.js says so), so no heavy work runs while letters type; 2.5 s at the latest
  let started = false;
  const go = () => { if (!started) { started = true; play(); } };
  addEventListener('tooth-ready', go, { once: true });
  setTimeout(go, 2500);
  function next() {
    if (!current) return;
    const old = current;
    old.classList.add('leave');
    setTimeout(() => old.remove(), 500);
    n = (n + 1) % PHRASES.length;
    current = show(PHRASES[n]);
    current.style.marginTop = '-1.08em'; // sit on the same line while the old one leaves
    setTimeout(() => { current.style.marginTop = ''; }, 520);
  }
})();

/* ========== 1 · hero depth layers follow the mouse ========== */
(() => {
  const art = $('.hero-bg'), scene = $('.depth-scene', art);
  const layers = $$('.layer', art).map(el => ({ el, d: +el.dataset.depth }));
  let cx = 0, cy = 0;
  loopWhileVisible(art, now => {
    const idle = !REDUCED && Math.abs(MOUSE.x) + Math.abs(MOUSE.y) < .001;
    const tx = idle ? Math.sin(now / 1400) * .5 : MOUSE.x, ty = idle ? Math.cos(now / 1100) * .35 : MOUSE.y;
    cx = lerp(cx, tx, .06); cy = lerp(cy, ty, .06);
    scene.style.transform = `rotateY(${cx * 6}deg) rotateX(${-cy * 6}deg)`;
    layers.forEach(l => { l.el.style.transform = `translate3d(${cx * l.d * 30}px, ${cy * l.d * 22}px, 0)`; });
  });
})();

/* ========== 2 · portal: fly through a tooth-shaped window (stands alone, as in lab 26) ========== */
(() => {
  const section = $('#portal'), scene = $('.portal-scene', section), copy = $('.portal-copy', section);
  const holes = $$('.ph', section), ring = $('.ph-ring', section);
  const words = [$('small', scene), $('h2', scene), $('.ps-chips', scene)];
  holes.forEach(p => p.setAttribute('d', TOOTH_D));
  loopWhileVisible(section, () => {
    const p = pinProgress(section);
    const s = 1.1 * Math.pow(56, Math.pow(clamp(p / .85), 1.5)); // exponential growth reads as flying at a steady speed
    holes.forEach(el => el.setAttribute('transform', `translate(500 270) scale(${s}) translate(-100 -80)`));
    ring.style.opacity = clamp(1 - p * 1.8);
    copy.style.opacity = clamp(1 - p * 3.2);
    copy.style.transform = `scale(${1 + p * 1.4})`;
    scene.style.transform = `scale(${1.28 - .28 * easeOut(p)})`;
    words.forEach((w, i) => {
      const q = easeOut(clamp((p - .6 - i * .06) / .16));
      w.style.opacity = q; w.style.transform = `translateY(${(1 - q) * 24}px)`;
    });
  });
})();

/* ========== 3 · pinned story: four beats ========== */
(() => {
  const section = $('#story'), beats = $$('.beat', section), rail = $('.rail i', section), n = beats.length;
  loopWhileVisible(section, () => {
    const p = pinProgress(section);
    beats.forEach((b, i) => {
      const d = (p - (i + .5) / n) * n;
      let o = clamp(1 - (Math.abs(d) - .3) * 5);
      if ((i === 0 && d < 0) || (i === n - 1 && d > 0)) o = 1;
      b.style.opacity = o; b.style.transform = `translateY(${-d * 60}px)`;
    });
    rail.style.height = p * 100 + '%';
  });
})();

/* ========== 5 · services slide sideways, curving gently like a ribbon ========== */
(() => {
  const section = $('#services'), track = $('#track'), bar = $('.bar i', section);
  track.innerHTML = SERVICES.map(s => `<article class="svc"><div class="ic">${ICONS[s.icon]()}</div><h3>${s.name}</h3>
    <div class="meta">${s.min} min · ${s.who}</div><div class="price">${egp(s.price)}</div></article>`).join('');
  const cards = $$('.svc', track);
  let last = 0, speed = 0;
  loopWhileVisible(section, () => {
    const p = pinProgress(section);
    const travel = Math.max(0, track.scrollWidth - innerWidth + 48);
    const x = -p * travel;
    track.style.transform = `translateX(${x}px)`;
    speed = lerp(speed, Math.abs(p - last) * 60, .1); last = p;
    const bend = 22 + Math.min(speed * 600, 26); // a gentle curve, deeper while you scroll fast
    cards.forEach(c => {
      const d = (c.offsetLeft + x + c.offsetWidth / 2 - innerWidth / 2) / innerWidth;
      c.style.transform = `rotateY(${-d * bend}deg) translateZ(${-Math.abs(d) * 140}px)`;
    });
    bar.style.width = p * 100 + '%';
  });
})();

/* ========== 6 · X-ray flashlight ========== */
(() => {
  const stage = $('#xray'), lens = $('.xr-lens', stage);
  const XS = [175, 305, 435, 565, 695, 825], S = .62, TOP = 150;
  const tooth = (x, attrs) => `<path d="${TOOTH_D}" transform="translate(${x - 100 * S} ${TOP}) scale(${S})" ${attrs}/>`;
  const pulp = (x, fill, extra = '') => `<path d="${TOOTH_D}" transform="translate(${x - 100 * S * .5} ${TOP + 38}) scale(${S * .5} ${S * .72})" fill="${fill}" ${extra}/>`;
  const GUM = 'M0 600 L0 238 L110 238 ' + XS.map(x => `Q${x} 292 ${x + 65} 238`).join(' ') + ' L1000 238 L1000 600 Z';
  const svg = body => `<svg viewBox="0 0 1000 500" preserveAspectRatio="xMidYMid slice">${body}</svg>`;
  $('.xr-smile', stage).innerHTML = svg(`
    <defs>
      <linearGradient id="smBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6faf7"/><stop offset="1" stop-color="#fff"/></linearGradient>
      <linearGradient id="smTooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e3f1ef"/></linearGradient>
      <linearGradient id="smGum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bdeee6"/><stop offset="1" stop-color="#8fd8cb"/></linearGradient>
    </defs>
    <rect x="-200" y="-200" width="1400" height="900" fill="url(#smBg)"/>
    <text x="500" y="92" text-anchor="middle" font-family="Geist, sans-serif" font-weight="750" font-size="40" fill="#0b2545">Looks healthy, right?</text>
    ${XS.map(x => tooth(x, 'fill="url(#smTooth)" stroke="#cfe9e5" stroke-width="5"')).join('')}
    <path d="${GUM}" fill="url(#smGum)"/>`);
  $('.xr-ray', stage).innerHTML = svg(`
    <defs>
      <radialGradient id="xrBg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#1b2838"/><stop offset="1" stop-color="#05080d"/></radialGradient>
      <linearGradient id="xrTooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f6fb"/><stop offset=".55" stop-color="#b6c4d3"/><stop offset="1" stop-color="#7c8b9e"/></linearGradient>
      <filter id="xrGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="xrSoft"><feGaussianBlur stdDeviation="2.5"/></filter>
      <pattern id="xrScan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="rgba(255,255,255,.05)"/></pattern>
    </defs>
    <rect x="-200" y="-200" width="1400" height="900" fill="url(#xrBg)"/>
    <text x="500" y="92" text-anchor="middle" font-family="Geist, sans-serif" font-weight="750" font-size="40" fill="#5eead4">What Dr. Sarah sees</text>
    <path d="${GUM}" fill="#3a4a5e" opacity=".55"/>
    <g filter="url(#xrGlow)" opacity=".93">${XS.map(x => tooth(x, 'fill="url(#xrTooth)" stroke="rgba(255,255,255,.55)" stroke-width="3"')).join('')}</g>
    ${XS.map((x, i) => (i === 3 ? pulp(x, '#ffffff', 'filter="url(#xrGlow)"') : pulp(x, '#253244'))).join('')}
    <ellipse cx="${XS[1] + 18}" cy="${TOP + 40}" rx="15" ry="10" fill="#070b11" filter="url(#xrSoft)"/>
    <rect x="${XS[4] - 26}" y="${TOP + 22}" width="52" height="26" rx="12" fill="#fff" filter="url(#xrGlow)"/>
    <g font-family="Geist Mono, monospace" font-size="21" fill="#5eead4">
      <path d="M${XS[1] + 30} ${TOP + 34} L${XS[1] + 70} 128" stroke="#5eead4" stroke-width="2"/><text x="${XS[1] + 76}" y="124">early cavity</text>
      <path d="M${XS[4] + 24} ${TOP + 30} L${XS[4] + 64} 128" stroke="#5eead4" stroke-width="2"/><text x="${XS[4] + 70}" y="124">old filling</text>
      <path d="M${XS[3]} ${TOP + 150} L${XS[3]} 430" stroke="#5eead4" stroke-width="2"/><text x="${XS[3]}" y="458" text-anchor="middle">treated root</text>
    </g>
    <rect x="-200" y="-200" width="1400" height="900" fill="url(#xrScan)"/>`);
  let tx = 0, ty = 0, x = 0, y = 0, inside = false;
  stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; inside = true; });
  stage.addEventListener('pointerleave', () => { inside = false; });
  loopWhileVisible(stage, now => {
    const w = stage.clientWidth, h = stage.clientHeight, R = w < 520 ? 84 : 130;
    if (!inside) { tx = w / 2 + Math.sin(now / 1500) * w * .33; ty = h * .45 + Math.sin(now / 1100) * h * .12; }
    x = lerp(x, tx, .14); y = lerp(y, ty, .14);
    stage.style.setProperty('--x', `${x}px`); stage.style.setProperty('--y', `${y}px`); stage.style.setProperty('--r', `${R}px`);
    lens.style.transform = `translate(${x - R}px, ${y - R}px)`;
  });
})();

/* ========== 7 · journey: the path draws itself; the 3D tooth rides the marker ========== */
(() => {
  const section = $('#how'), win = $('.journey-window', section), svg = $('.jr', section);
  const D = 'M300 70 C 520 170, 520 330, 300 420 S 80 660, 300 750 S 520 990, 300 1080 S 80 1320, 300 1410 L 300 1530';
  const STOPS = [
    [.06, '11:42 PM: a question', 'The assistant answers instantly'],
    [.29, 'Booked in 30 seconds', 'Thursday 4:30 PM · Dr. Sarah'],
    [.52, 'Reminder, the day before', 'One tap to confirm'],
    [.75, 'The visit', 'No waiting, no paperwork'],
    [.97, 'Six months later', 'A friendly check-up nudge'],
  ];
  svg.innerHTML = `<path class="base" d="${D}"/><path class="prog" d="${D}"/><g class="nodes"></g><g class="marker"><circle r="30"/></g>`;
  const prog = $('.prog', svg), len = prog.getTotalLength(), marker = $('.marker', svg);
  prog.style.strokeDasharray = len;
  // Measure once (and on resize) so the frame loop never has to read layout.
  const geo = {};
  const measure = () => {
    const sr = section.getBoundingClientRect(), pr = $('.pin', section).getBoundingClientRect(), wr = win.getBoundingClientRect(), br = svg.getBoundingClientRect();
    Object.assign(geo, { absTop: sr.top + scrollY, height: section.offsetHeight, winTop: wr.top - pr.top, winH: wr.height, svgLeft: br.left, k: br.width / 600, svgH: br.height });
  };
  measure(); addEventListener('resize', measure); document.fonts?.ready.then(measure);
  window.journeyMarker = { x: 0, y: 0 }; // where the marker is on screen; companion.js rides it
  const nodes = STOPS.map(([f, title, sub]) => {
    const pt = prog.getPointAtLength(len * f), right = pt.x <= 300;
    const lx = right ? pt.x + 40 : pt.x - 40, anchor = right ? 'start' : 'end';
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'node');
    g.innerHTML = `<circle cx="${pt.x}" cy="${pt.y}" r="12"/>
      <text class="t" x="${lx}" y="${pt.y - 4}" text-anchor="${anchor}">${title}</text>
      <text class="s" x="${lx}" y="${pt.y + 20}" text-anchor="${anchor}">${sub}</text>`;
    $('.nodes', svg).append(g);
    return { f, g };
  });
  let pan = 0;
  loopWhileVisible(section, () => {
    const p = clamp(pinProgress(section) * 1.06);
    prog.style.strokeDashoffset = len * (1 - p);
    const pt = prog.getPointAtLength(len * p);
    marker.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
    nodes.forEach(n => n.g.classList.toggle('on', p >= n.f - .005));
    pan = lerp(pan, clamp(pt.y * geo.k - geo.winH / 2, 0, Math.max(0, geo.svgH - geo.winH)), .14);
    svg.style.transform = `translateY(${-pan}px)`;
    window.journeyMarker.x = geo.svgLeft + pt.x * geo.k;
    window.journeyMarker.y = pinTopScreen(geo.absTop, geo.height) + geo.winTop + pt.y * geo.k - pan;
  });
})();

/* ========== 8 · live AI receptionist ========== */
(() => {
  const chat = $('#chat'), body = $('.chat-body', chat);
  const SCRIPT = [
    { me: 'How much is teeth whitening?' },
    { bot: 'Teeth whitening is 4,500 EGP: one 60-minute session at the clinic with Dr. Sarah Mansour. Want me to find you a time?', src: 'Source: Services & prices' },
    { me: 'Yes, Thursday afternoon please' },
    { bot: "Here's what's free on Thursday afternoon:", slots: ['2:00 PM', '4:30 PM', '5:15 PM'], pick: 1 },
    { me: '4:30 PM' },
    { bot: "Booked ✓ Teeth whitening · Thu 4:30 PM · Dr. Sarah. I'll remind you the day before.", confirm: true },
  ];
  let run = 0;
  const add = (cls, html = '') => { const m = Object.assign(document.createElement('div'), { className: 'msg ' + cls }); m.innerHTML = html; body.append(m); return m; };
  async function play() {
    const id = ++run, alive = () => id === run;
    body.textContent = '';
    for (const step of SCRIPT) {
      await wait(step.me ? 500 : 150); if (!alive()) return;
      if (step.me) { add('me').textContent = step.me; continue; }
      const typing = add('bot', '<span class="dots"><i></i><i></i><i></i></span>');
      await wait(550); if (!alive()) return;
      typing.remove();
      const m = add('bot' + (step.confirm ? ' confirm' : '')), txt = document.createElement('span');
      m.append(txt);
      for (let i = 2; i <= step.bot.length + 1; i += 2) { if (!alive()) return; txt.textContent = step.bot.slice(0, i); await wait(12); } // two letters at a time
      if (step.src) m.append(Object.assign(document.createElement('div'), { className: 'src', textContent: step.src }));
      if (step.slots) {
        const row = Object.assign(document.createElement('div'), { className: 'slots' });
        row.innerHTML = step.slots.map(s => `<span>${s}</span>`).join('');
        m.append(row);
        await wait(450); if (!alive()) return;
        row.children[step.pick].classList.add('pick');
      }
    }
    await wait(4000);
    if (alive()) play();
  }
  whenVisible(chat, play, () => run++, 0.4);
})();

/* ========== 9 · under the hood: the stack opens, then one question travels down and back up ========== */
(() => {
  const section = $('#stack'), stack = $('.stack3d', section), lays = $$('.lay', section), pulse = $('.pulse', section), beam = $('.beam', section);
  const items = $$('.layers-list li', section), status = $('.stack-status .txt', section);
  // the question's route, layer by layer (3 = website on top, 0 = database at the bottom), and what happens at each stop
  const ROUTE = [3, 2, 1, 0, 2, 3];
  const SAY = [
    'Patient asks: “Is Thursday free?”',
    'The agent understands: a Thursday slot',
    'Checks clinic knowledge: whitening is 60 min',
    'Finds 4:30 PM free in the calendar',
    'The agent writes the answer',
    'Answer on screen, slot held · 1.2 s',
  ];
  const zOf = (i, open) => (i * 104 - 156) * open;
  let lastSay = '';
  loopWhileVisible(section, now => {
    const p = pinProgress(section);
    // 1) open: the stack tilts and the layers lift apart
    const open = easeInOut(clamp(p / .26));
    stack.style.transform = `rotateX(${58 * open}deg) rotateZ(${-38 * open + Math.sin(now / 2400) * 2 * open}deg)`;
    lays.forEach((l, i) => { l.style.transform = `translateZ(${zOf(i, open) + Math.sin(now / 1300 + i) * 3 * open}px)`; });
    // 2) travel: a glowing pulse visits each stop on the route
    const q = clamp((p - .3) / .56) * (ROUTE.length - 1);
    const seg = Math.min(ROUTE.length - 2, Math.floor(q)), f = easeInOut(q - seg);
    const z = lerp(zOf(ROUTE[seg], open), zOf(ROUTE[seg + 1], open), f);
    const travelling = p > .28 && p < .9;
    pulse.style.opacity = travelling ? 1 : 0;
    beam.style.opacity = travelling ? .85 : 0;
    beam.style.transform = `rotateX(90deg) scaleY(${open})`; // stands upright, through every layer
    pulse.style.transform = `translateZ(${z + 16}px) rotateZ(38deg) rotateX(-58deg) scale(${1 + Math.sin(now / 160) * .12})`;
    const stop = p < .3 ? -1 : ROUTE[Math.round(q)];
    const done = p >= .86;
    section.classList.toggle('done', done);
    lays.forEach((l, i) => { l.classList.toggle('on', i === stop && !done); l.classList.toggle('dim', stop >= 0 && i !== stop && !done); });
    items.forEach(li => li.classList.toggle('on', +li.dataset.layer === stop && !done));
    const say = p < .28 ? 'Scroll to send a question' : SAY[Math.min(SAY.length - 1, Math.round(q))];
    if (say !== lastSay) { status.textContent = say; lastSay = say; }
  });
})();

/* ========== 10 · glass card tilts toward the cursor ========== */
(() => {
  const section = $('#book'), card = $('#glass');
  section.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect(), s = section.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    card.style.transform = `rotateY(${((e.clientX - s.left) / s.width - .5) * 10}deg) rotateX(${-((e.clientY - s.top) / s.height - .5) * 10}deg)`;
  });
  section.addEventListener('pointerleave', () => { card.style.transform = ''; });
})();
