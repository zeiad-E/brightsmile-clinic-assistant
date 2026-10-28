// BrightSmile effects lab: each numbered block below powers one demo on the page.

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const DPR = Math.min(window.devicePixelRatio || 1, 2); // study rule: cap pixel ratio at 2

if (matchMedia('(prefers-reduced-motion: reduce)').matches) $('#motionNotice').hidden = false;

/* ---------- clinic data (from supabase/seed.sql) ---------- */
const SERVICES = [
  { name: 'Check-up & consultation', min: 20, price: 400, who: 'Dr. Sarah · Dr. Karim', icon: 'search', color: ['#14b8a6', '#0f766e'] },
  { name: 'Teeth cleaning', min: 30, price: 800, who: 'Nadia Fawzy, hygienist', icon: 'sparkle', color: ['#38bdf8', '#0369a1'] },
  { name: 'Tooth filling', min: 45, price: 1200, who: 'Dr. Sarah · Dr. Karim', icon: 'shield', color: ['#818cf8', '#4338ca'] },
  { name: 'Tooth extraction', min: 30, price: 1000, who: 'Dr. Karim Adel', icon: 'extract', color: ['#94a3b8', '#334155'] },
  { name: 'Root canal treatment', min: 90, price: 3500, who: 'Dr. Sarah Mansour', icon: 'pulse', color: ['#fb7185', '#be123c'] },
  { name: 'Teeth whitening', min: 60, price: 4500, who: 'Dr. Sarah Mansour', icon: 'smile', color: ['#fbbf24', '#d97706'] },
  { name: "Children's check-up", min: 30, price: 500, who: 'Dr. Karim · Nadia', icon: 'kids', color: ['#4ade80', '#15803d'] },
  { name: 'Braces consultation', min: 30, price: 500, who: 'Dr. Sarah Mansour', icon: 'braces', color: ['#c084fc', '#7e22ce'] },
];
const egp = n => n.toLocaleString('en-US') + ' EGP';

/* ---------- shared drawings ---------- */
// One tooth outline in a 200 x 240 box, reused by the canvas demos and the SVG icons.
const TOOTH_D = 'M40 30 C60 5 85 20 100 22 C115 20 140 5 160 30 C182 58 175 105 160 130 C150 150 148 175 142 205 C138 225 122 232 116 210 C110 185 106 165 100 165 C94 165 90 185 84 210 C78 232 62 225 58 205 C52 175 50 150 40 130 C25 105 18 58 40 30 Z';
const TOOTH = new Path2D(TOOTH_D);

const line = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const MOUTH_D = 'M40 48 C90 40 120 50 150 52 C180 50 210 40 260 48 C235 98 195 116 150 116 C105 116 65 98 40 48Z';
let uid = 0;

const ICONS = {
  toothSolid: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#14b8a6"/></svg>`,
  toothSolidWhite: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#fff"/></svg>`,
  toothGlow: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#fff"/></svg>`,
  chat: () => line('<path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>'),
  calendar: () => line('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>'),
  bell: () => line('<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'),
  smile: () => line('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>'),
  sparkle: () => line('<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>'),
  shield: () => line('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  pulse: () => line('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
  extract: () => line('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  kids: () => line('<circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-6 7-6s7 2 7 6"/>'),
  braces: () => line('<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M7.5 9v6M12 9v6M16.5 9v6"/>'),
  search: () => line('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>'),
  phone: () => line('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  pin: () => line('<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  smileMouth: el => {
    const id = 'mouth' + (++uid), t = el.dataset.teeth || '#ffffff';
    const upper = Array.from({ length: 8 }, (_, i) => `<rect x="${48 + i * 26}" y="40" width="24" height="36" rx="6" fill="${t}"/>`).join('');
    const lower = Array.from({ length: 7 }, (_, i) => `<rect x="${62 + i * 25}" y="86" width="23" height="30" rx="6" fill="${t}"/>`).join('');
    return `<svg viewBox="0 0 300 145"><defs><clipPath id="${id}"><path d="${MOUTH_D}"/></clipPath></defs>
      <path d="M10 40 C60 8 120 28 150 34 C180 28 240 8 290 40 C262 112 205 138 150 138 C95 138 38 112 10 40Z" fill="#e8738a"/>
      <path d="${MOUTH_D}" fill="#5a1a2a"/><g clip-path="url(#${id})">${upper}${lower}</g></svg>`;
  },
  mascot: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#fff" stroke="#bfe9e2" stroke-width="5"/>
    <path d="M56 54 C64 40 80 36 90 42" stroke="#e6faf7" stroke-width="10" fill="none" stroke-linecap="round"/>
    <ellipse cx="76" cy="104" rx="9" ry="12" fill="#0b2545"/><ellipse cx="124" cy="104" rx="9" ry="12" fill="#0b2545"/>
    <circle cx="79" cy="99" r="3" fill="#fff"/><circle cx="127" cy="99" r="3" fill="#fff"/>
    <circle cx="60" cy="128" r="10" fill="#fb7185" opacity=".35"/><circle cx="140" cy="128" r="10" fill="#fb7185" opacity=".35"/>
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

/* ---------- helpers shared by the demos ---------- */
function whenVisible(el, onIn, onOut, threshold = 0.4) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? onIn() : onOut && onOut()), { threshold }).observe(el);
}

// Plays a CSS ".in" reveal each time the element enters view, and again on its Replay button.
function reveal(el) {
  const reset = () => { el.classList.add('reset'); el.classList.remove('in'); void el.offsetWidth; el.classList.remove('reset'); };
  const play = () => { reset(); requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in'))); };
  whenVisible(el, play, reset);
  $('.replay', el)?.addEventListener('click', play);
}

// Sizes a canvas to its box (capped DPR) and reports the size in CSS pixels.
function fitCanvas(canvas, onResize) {
  const ctx = canvas.getContext('2d');
  new ResizeObserver(() => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    onResize(w, h);
  }).observe(canvas);
  return ctx;
}

/* ---------- the one scroll value: every pinned demo reads its own 0→1 progress here ---------- */
const pinned = [];
function onPinnedScroll(section, stage, update) { pinned.push({ section, stage, update, last: -1, start: 0, end: 1 }); }

// Where does each sticky stage start and stop sticking? Measured once per resize.
function measurePins() {
  for (const p of pinned) {
    const pos = p.stage.style.position;
    p.stage.style.position = 'static';
    const offset = p.stage.getBoundingClientRect().top - p.section.getBoundingClientRect().top;
    p.stage.style.position = pos;
    const sticky = parseFloat(getComputedStyle(p.stage).top) || 0;
    const padBottom = parseFloat(getComputedStyle(p.section).paddingBottom) || 0;
    p.start = sticky - offset;                                                  // section top when the stage sticks
    p.end = sticky + p.stage.offsetHeight + padBottom - p.section.offsetHeight; // section top when it lets go
    p.last = -1;
  }
}
addEventListener('resize', measurePins);
document.fonts?.ready.then(measurePins);

function tickPins() {
  for (const p of pinned) {
    const top = p.section.getBoundingClientRect().top;
    if (top > innerHeight || top < p.end - innerHeight) continue;
    const progress = clamp((p.start - top) / (p.start - p.end));
    if (progress !== p.last) { p.last = progress; p.update(progress); }
  }
  requestAnimationFrame(tickPins);
}

/* ---------- bonus: smooth inertial scroll (what Lenis does, in a few lines) ---------- */
const smooth = (() => {
  let on = true, target = scrollY, current = scrollY, running = false;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const tick = () => {
    current = lerp(current, target, 0.09);
    if (Math.abs(target - current) < 0.4) { current = target; running = false; }
    window.scrollTo(0, current);
    if (running) requestAnimationFrame(tick);
  };
  const start = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
  addEventListener('wheel', e => {
    if (!on || e.ctrlKey) return;
    e.preventDefault();
    target = clamp(target + e.deltaY * (e.deltaMode === 1 ? 40 : 1), 0, max());
    start();
  }, { passive: false });
  addEventListener('scroll', () => { if (!running) target = current = scrollY; });
  return {
    set(v) { on = v; },
    to(y) {
      y = clamp(y, 0, max());
      if (on) { target = y; current = scrollY; start(); } else window.scrollTo({ top: y, behavior: 'smooth' });
    },
  };
})();
$('#smoothToggle').addEventListener('click', e => {
  const btn = e.currentTarget, v = btn.getAttribute('aria-pressed') !== 'true';
  btn.setAttribute('aria-pressed', v); smooth.set(v);
});

/* ---------- header chips ---------- */
const sections = $$('.fx');
sections.forEach((s, i) => {
  const a = document.createElement('a');
  a.href = '#' + s.id; a.textContent = i + 1; a.title = $('h2', s).textContent;
  a.addEventListener('click', e => { e.preventDefault(); smooth.to(s.getBoundingClientRect().top + scrollY - 64); });
  $('#chips').append(a);
});
let activeChip = -1;
addEventListener('scroll', () => {
  let idx = -1;
  sections.forEach((s, i) => { if (s.getBoundingClientRect().top < innerHeight * 0.45) idx = i; });
  if (idx === activeChip) return;
  $$('#chips a').forEach((a, i) => a.classList.toggle('on', i === idx));
  $$('#chips a')[idx]?.scrollIntoView({ inline: 'center', block: 'nearest' });
  activeChip = idx;
}, { passive: true });

/* ========== 01 boot loader ========== */
(() => {
  const el = $('#boot'), linesEl = $('.boot-lines', el), countEl = $('.boot-count span', el), bar = $('.boot-bar i', el);
  const LINES = [
    ['> starting BrightSmile assistant', ''],
    ['> clinic hours ..............', ' ok'],
    ['> 8 services & prices .......', ' ok'],
    ['> Dr. Sarah · Dr. Karim .....', ' ok'],
    ['> ready to book your visit', ' ✓'],
  ];
  const caret = Object.assign(document.createElement('span'), { className: 'boot-caret' });
  let run = 0;
  async function play() {
    const id = ++run, total = 2600, t0 = performance.now();
    el.classList.remove('done'); linesEl.textContent = '';
    (function count(now) {
      if (id !== run) return;
      const p = clamp((now - t0) / total), v = Math.round(easeInOut(p) * 100);
      countEl.textContent = v; bar.style.width = v + '%';
      if (p < 1) requestAnimationFrame(count);
    })(t0);
    for (const [text, ok] of LINES) {
      const row = document.createElement('div');
      linesEl.append(row);
      for (let i = 1; i <= text.length; i++) {
        if (id !== run) return;
        row.textContent = text.slice(0, i); row.append(caret);
        await wait(13);
      }
      row.textContent = text;
      if (ok) row.append(Object.assign(document.createElement('span'), { className: 'ok', textContent: ok }));
      await wait(110);
    }
    await wait(Math.max(0, total - (performance.now() - t0)) + 250);
    if (id === run) el.classList.add('done');
  }
  whenVisible(el, play, () => run++);
  $('.replay', el).addEventListener('click', play);
})();

/* ========== 02 giant name ========== */
reveal($('#giant'));

/* ========== 03 letter-by-letter ========== */
(() => {
  const h = $('[data-split]');
  h.setAttribute('aria-label', h.textContent);
  let i = 0;
  const walk = node => [...node.childNodes].forEach(n => {
    if (n.nodeType !== 3) return walk(n);
    const frag = document.createDocumentFragment();
    n.textContent.split(/(\s+)/).forEach(part => {
      if (!part) return;
      if (/^\s+$/.test(part)) return frag.append(' ');
      const w = Object.assign(document.createElement('span'), { className: 'w' });
      w.setAttribute('aria-hidden', 'true');
      [...part].forEach(ch => {
        const c = Object.assign(document.createElement('span'), { className: 'c', textContent: ch });
        c.style.setProperty('--i', i++);
        w.append(c);
      });
      frag.append(w);
    });
    n.replaceWith(frag);
  });
  walk(h);
  reveal($('#letters'));
})();

/* ========== 04 image-sequence scroll scrub ========== */
(() => {
  const section = $('#fx-4'), stage = $('#seq'), canvas = $('canvas', stage);
  const frameLbl = $('.seq-frame', stage), loadLbl = $('.seq-load', stage), caption = $('.seq-caption', stage), bar = $('.hud-bar i', stage);
  const N = 120, FW = 960, FH = 600;
  const frames = new Array(N);
  let W = 0, H = 0, current = -1, progress = 0;

  // Seeded random so the shards fly in the same way every time.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  // Cut the tooth's box into 60 triangles; each flies in from its own direction.
  const shards = [];
  const cols = 5, rows = 6, cw = 220 / cols, ch = 260 / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -10 + c * cw, y = -10 + r * ch;
    const quads = [[[x, y], [x + cw, y], [x, y + ch]], [[x + cw, y], [x + cw, y + ch], [x, y + ch]]];
    for (const tri of quads) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const pts = tri.map(([px, py]) => [cx + (px - cx) * 1.03, cy + (py - cy) * 1.03]); // tiny overlap hides seams
      const a = rand() * Math.PI * 2, d = 240 + rand() * 260;
      shards.push({ pts, cx, cy, dx: Math.cos(a) * d, dy: Math.sin(a) * d, rot: (rand() - .5) * 5, delay: rand() * 0.4 });
    }
  }

  const mix = (a, b, t) => {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    return `rgb(${lerp(r1, r2, t) | 0},${lerp(g1, g2, t) | 0},${lerp(b1, b2, t) | 0})`;
  };
  const star = (c, x, y, r) => {
    c.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .22 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    c.closePath(); c.fill();
  };

  // Draws frame t (0→1). Used to make the frame images, and live while they are still being made.
  function drawFrame(c, w, h, t) {
    const g = c.createRadialGradient(w / 2, h * .45, 0, w / 2, h * .45, Math.max(w, h) * .7);
    g.addColorStop(0, mix('#12345f', '#2aa8a0', .15 + .55 * t)); g.addColorStop(.5, '#12345f'); g.addColorStop(1, '#0b2545');
    c.fillStyle = g; c.fillRect(0, 0, w, h);

    const s = Math.min(w / 200, h / 240) * .6;
    c.save();
    c.translate(w / 2 - 100 * s, h * .46 - 120 * s); c.scale(s, s);
    const white = easeInOut(clamp((t - .45) / .5));
    const fill = c.createLinearGradient(0, 0, 0, 240);
    fill.addColorStop(0, mix('#d9c48a', '#ffffff', white)); fill.addColorStop(1, mix('#b89e5c', '#d8f3ef', white));

    for (const sh of shards) {
      const k = 1 - easeOut(clamp((t - sh.delay) / .55));
      c.save();
      c.globalAlpha = clamp(1.15 - k * 1.1);
      c.translate(sh.cx + sh.dx * k, sh.cy + sh.dy * k); c.rotate(sh.rot * k); c.translate(-sh.cx, -sh.cy);
      c.beginPath(); c.moveTo(...sh.pts[0]); c.lineTo(...sh.pts[1]); c.lineTo(...sh.pts[2]); c.closePath(); c.clip();
      c.fillStyle = fill; c.fill(TOOTH);
      c.lineWidth = 3; c.strokeStyle = 'rgba(94,234,212,.9)'; c.stroke(TOOTH);
      c.restore();
    }
    if (t > .95) { // every shard has landed: draw it whole, with a glow
      c.shadowColor = `rgba(94,234,212,${(t - .95) * 14})`; c.shadowBlur = 40;
      c.fillStyle = fill; c.fill(TOOTH); c.shadowBlur = 0;
      c.lineWidth = 3; c.strokeStyle = 'rgba(94,234,212,.9)'; c.stroke(TOOTH);
    }
    if (t > .82) { // shine and sparkles
      const k = easeOut((t - .82) / .18);
      c.fillStyle = `rgba(255,255,255,${.85 * k})`;
      c.beginPath(); c.ellipse(70, 62, 14 * k, 26 * k, -.5, 0, Math.PI * 2); c.fill();
      c.fillStyle = `rgba(255,255,255,${k})`;
      star(c, 196, 20, 20 * k); star(c, 8, 120, 13 * k); star(c, 182, 168, 10 * k);
    }
    c.restore();
  }

  const ctx = fitCanvas(canvas, (w, h) => { W = w; H = h; current = -1; render(); });

  function render() {
    const idx = Math.round(progress * (N - 1));
    if (idx === current || !W) return;
    current = idx;
    const img = frames[idx];
    if (img) {
      const sc = Math.max(W / FW, H / FH), dw = FW * sc, dh = FH * sc;
      ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      drawFrame(ctx, W, H, idx / (N - 1));
    }
    frameLbl.textContent = `frame ${String(idx + 1).padStart(3, '0')} / ${N}`;
    bar.style.width = progress * 100 + '%';
    caption.textContent = progress < .3 ? 'Scroll to rebuild the smile' : progress < .7 ? 'Restoring…' : progress < .95 ? 'Whitening…' : 'Bright again.';
  }

  // Make the 120 frames as WebP images, like a real AI-video export, but in the browser.
  let made = false;
  async function makeFrames() {
    if (made) return; made = true;
    const off = document.createElement('canvas'); off.width = FW; off.height = FH;
    const oc = off.getContext('2d');
    for (let i = 0; i < N; i++) {
      drawFrame(oc, FW, FH, i / (N - 1));
      const blob = await new Promise(r => off.toBlob(r, 'image/webp', .82));
      const img = new Image(); img.src = URL.createObjectURL(blob);
      await img.decode();
      frames[i] = img;
      loadLbl.textContent = i < N - 1 ? `frames ready ${i + 1} / ${N}` : `${N} WebP frames ready`;
    }
    current = -1; render();
  }
  new IntersectionObserver(([e]) => e.isIntersecting && makeFrames(), { rootMargin: '900px' }).observe(section);

  onPinnedScroll(section, stage, p => { progress = p; render(); });
})();

/* ========== 05 pinned storytelling ========== */
(() => {
  const section = $('#fx-5'), stage = $('#story');
  const beats = $$('.beat', stage), icons = $$('[data-beat]', stage), rail = $('.rail i', stage), n = beats.length;
  onPinnedScroll(section, stage, p => {
    beats.forEach((b, i) => {
      const d = (p - (i + .5) / n) * n; // -0.5..0.5 while this beat owns the scroll
      let o = clamp(1 - (Math.abs(d) - .3) * 3.3);
      if ((i === 0 && d < 0) || (i === n - 1 && d > 0)) o = 1;
      b.style.opacity = o; b.style.transform = `translateY(${-d * 60}px)`;
    });
    const active = Math.min(n - 1, Math.floor(p * n));
    icons.forEach((ic, i) => { ic.firstChild.style.opacity = i === active ? 1 : 0; ic.firstChild.style.transform = `scale(${i === active ? 1 : .6})`; });
    rail.style.height = p * 100 + '%';
  });
})();

/* ========== 06 horizontal scroll ========== */
(() => {
  const section = $('#fx-6'), stage = $('#hscroll'), track = $('#hscrollTrack'), bar = $('.hud-bar i', stage);
  track.innerHTML = `<article class="svc lead"><h5>Our services</h5><p>Eight treatments, real prices, two dentists and a hygienist. Keep scrolling.</p></article>` +
    SERVICES.map(s => `<article class="svc"><div class="ic">${ICONS[s.icon]()}</div><h5>${s.name}</h5><div class="meta">${s.min} min · ${s.who}</div><div class="price">${egp(s.price)}</div></article>`).join('');
  onPinnedScroll(section, stage, p => {
    track.style.transform = `translateX(${-p * Math.max(0, track.scrollWidth - stage.clientWidth)}px)`;
    bar.style.width = p * 100 + '%';
  });
})();

/* ========== 07 particle morph ========== */
(() => {
  const stage = $('#particles'), canvas = $('canvas', stage), label = $('.shape-label', stage), chipsEl = $('.shape-chips', stage);
  const N = innerWidth < 700 ? 800 : 1400, BOX = 240;
  const SHAPES = [
    { chip: 'Tooth', label: 'Healthy teeth', draw: c => { c.translate(30, 12); c.scale(.9, .9); c.fill(TOOTH); } },
    { chip: 'Chat', label: '24/7 AI assistant', draw: c => {
      c.beginPath(); c.roundRect(20, 40, 200, 136, 36); c.moveTo(62, 168); c.lineTo(40, 214); c.lineTo(112, 172); c.fill();
      c.globalCompositeOperation = 'destination-out';
      [80, 120, 160].forEach(x => { c.beginPath(); c.arc(x, 108, 12, 0, Math.PI * 2); c.fill(); });
    } },
    { chip: 'Calendar', label: 'Easy booking', draw: c => {
      c.beginPath(); c.roundRect(28, 46, 184, 168, 22); c.fill();
      c.globalCompositeOperation = 'destination-out';
      c.fillRect(28, 88, 184, 6);
      for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) if (!(r === 1 && k === 2)) c.fillRect(46 + k * 40, 108 + r * 34, 28, 22);
      c.globalCompositeOperation = 'source-over';
      c.beginPath(); c.roundRect(74, 26, 14, 38, 7); c.roundRect(152, 26, 14, 38, 7); c.fill();
    } },
    { chip: 'Sparkle', label: 'Bright results', draw: c => {
      const st = (x, y, r) => { c.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 - Math.PI / 2, rr = i % 2 ? r * .24 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.fill(); };
      st(110, 130, 100); st(196, 48, 32); st(40, 46, 18);
    } },
  ];

  // Turn each drawing into a list of points: every few filled pixels becomes a target.
  const off = document.createElement('canvas'); off.width = off.height = BOX;
  const oc = off.getContext('2d', { willReadFrequently: true });
  SHAPES.forEach(s => {
    oc.setTransform(1, 0, 0, 1, 0, 0); oc.globalCompositeOperation = 'source-over'; oc.clearRect(0, 0, BOX, BOX);
    oc.fillStyle = '#000'; s.draw(oc);
    const data = oc.getImageData(0, 0, BOX, BOX).data, pts = [];
    for (let y = 0; y < BOX; y += 3) for (let x = 0; x < BOX; x += 3) if (data[(y * BOX + x) * 4 + 3] > 128) pts.push([x, y]);
    for (let i = pts.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pts[i], pts[j]] = [pts[j], pts[i]]; }
    s.pts = pts;
  });

  const x = new Float32Array(N), y = new Float32Array(N), vx = new Float32Array(N), vy = new Float32Array(N);
  const tx = new Float32Array(N), ty = new Float32Array(N), size = new Float32Array(N);
  let W = 0, H = 0, shape = 0, mx = -9999, my = -9999, running = false, lastPick = 0;
  const COLORS = ['#5eead4', '#ffffff', '#7dd3fc'];

  function setShape(i, user) {
    shape = i; if (user) lastPick = performance.now();
    label.textContent = SHAPES[i].label;
    $$('button', chipsEl).forEach((b, k) => b.classList.toggle('on', k === i));
    const pts = SHAPES[i].pts, sc = Math.min(W, H) * .7 / BOX, ox = W / 2 - BOX / 2 * sc, oy = H / 2 - BOX / 2 * sc - 4;
    for (let k = 0; k < N; k++) {
      const [px, py] = pts[k % pts.length];
      tx[k] = ox + px * sc + (Math.random() - .5) * 1.5; ty[k] = oy + py * sc + (Math.random() - .5) * 1.5;
      vx[k] += (Math.random() - .5) * 6; vy[k] += (Math.random() - .5) * 6;
    }
  }
  SHAPES.forEach((s, i) => {
    const b = Object.assign(document.createElement('button'), { textContent: s.chip });
    b.addEventListener('click', () => setShape(i, true));
    chipsEl.append(b);
  });

  const ctx = fitCanvas(canvas, (w, h) => {
    const first = !W; W = w; H = h;
    if (first) for (let k = 0; k < N; k++) { x[k] = Math.random() * w; y[k] = Math.random() * h; size[k] = Math.random() < .15 ? 3 : 2; }
    setShape(shape);
  });

  stage.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  stage.addEventListener('pointerleave', () => { mx = my = -9999; });

  let lastSwitch = performance.now();
  function frame(now) {
    if (!running) return;
    if (now - lastSwitch > 3400 && now - lastPick > 7000) { lastSwitch = now; setShape((shape + 1) % SHAPES.length); }
    const R = 80;
    for (let k = 0; k < N; k++) {
      vx[k] = (vx[k] + (tx[k] - x[k]) * .012) * .88;
      vy[k] = (vy[k] + (ty[k] - y[k]) * .012) * .88;
      const dx = x[k] - mx, dy = y[k] - my, d2 = dx * dx + dy * dy;
      if (d2 < R * R) { const d = Math.sqrt(d2) || 1, f = (1 - d / R) * 2.4; vx[k] += dx / d * f; vy[k] += dy / d * f; }
      x[k] += vx[k]; y[k] += vy[k];
    }
    ctx.clearRect(0, 0, W, H);
    COLORS.forEach((col, ci) => {
      ctx.fillStyle = col; ctx.globalAlpha = ci === 1 ? .9 : .75;
      for (let k = ci; k < N; k += COLORS.length) ctx.fillRect(x[k], y[k], size[k], size[k]);
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  whenVisible(stage, () => { if (!running) { running = true; requestAnimationFrame(frame); } }, () => { running = false; }, 0.1);
})();

/* ========== 08 depth-layer parallax ========== */
(() => {
  const stage = $('#depth'), scene = $('.depth-scene', stage);
  const layers = $$('.layer', stage).map(el => ({ el, d: +el.dataset.depth }));
  let tx = 0, ty = 0, cx = 0, cy = 0, inside = false, running = false;
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - .5) * 2; ty = ((e.clientY - r.top) / r.height - .5) * 2; inside = true;
  });
  stage.addEventListener('pointerleave', () => { inside = false; });
  function frame(now) {
    if (!running) return;
    if (!inside) { tx = Math.sin(now / 1400) * .5; ty = Math.cos(now / 1100) * .35; } // gentle drift when idle
    cx = lerp(cx, tx, .07); cy = lerp(cy, ty, .07);
    scene.style.transform = `rotateY(${cx * 6}deg) rotateX(${-cy * 6}deg)`;
    layers.forEach(l => { l.el.style.transform = `translate3d(${cx * l.d * 36}px, ${cy * l.d * 26}px, 0)`; });
    requestAnimationFrame(frame);
  }
  whenVisible(stage, () => { if (!running) { running = true; requestAnimationFrame(frame); } }, () => { running = false; }, 0.1);
})();

/* ========== 09 cursor-follow preview ========== */
(() => {
  const stage = $('#plist'), card = $('#preview'), art = $('.preview-art', card), body = $('.preview-body', card);
  SERVICES.forEach((s, i) => {
    const b = document.createElement('button');
    b.innerHTML = `<span>${s.name}</span><span>${egp(s.price)}</span>`;
    const show = () => {
      $$('button', stage).forEach(x => x.classList.toggle('on', x === b));
      stage.classList.add('hovering'); card.classList.add('show');
      art.style.background = `linear-gradient(140deg, ${s.color[0]}, ${s.color[1]})`;
      art.innerHTML = ICONS[s.icon]();
      body.innerHTML = `<strong>${s.name}</strong><em>${s.min} min · ${egp(s.price)}</em><br>${s.who}`;
    };
    b.addEventListener('pointerenter', show);
    b.addEventListener('focus', () => { // keyboard: park the card beside the focused row
      show();
      const r = b.getBoundingClientRect(), sr = stage.getBoundingClientRect();
      tx = Math.min(sr.width - 240, r.left - sr.left + r.width * .45); ty = clamp(r.top - sr.top - 40, 8, sr.height - 210);
    });
    stage.append(b);
  });
  const hide = () => { stage.classList.remove('hovering'); card.classList.remove('show'); $$('button', stage).forEach(x => x.classList.remove('on')); };
  stage.addEventListener('pointerleave', hide);
  stage.addEventListener('focusout', e => { if (!stage.contains(e.relatedTarget)) hide(); });

  let tx = 0, ty = 0, cx = 0, cy = 0, running = false;
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    tx = Math.min(e.clientX - r.left + 20, r.width - 232); ty = clamp(e.clientY - r.top + 20, 8, r.height - 210);
  });
  function frame() {
    if (!running) return;
    cx = lerp(cx, tx, .14); cy = lerp(cy, ty, .14);
    card.style.translate = `${cx}px ${cy}px`;
    requestAnimationFrame(frame);
  }
  whenVisible(stage, () => { if (!running) { running = true; requestAnimationFrame(frame); } }, () => { running = false; }, 0.1);
})();

/* ========== 10 magnetic button ========== */
(() => {
  const stage = $('#magnet'), btn = $('#mbtn'), lbl = $('.lbl', btn), R = 200;
  const rest = () => {
    btn.classList.remove('moving'); btn.style.transform = ''; lbl.style.transform = ''; btn.style.setProperty('--glow', 0);
  };
  stage.addEventListener('pointermove', e => {
    const s = stage.getBoundingClientRect(), dx = e.clientX - (s.left + s.width / 2), dy = e.clientY - (s.top + s.height / 2);
    const dist = Math.hypot(dx, dy);
    if (dist > R) return rest();
    const b = btn.getBoundingClientRect();
    btn.classList.add('moving');
    btn.style.transform = `translate(${dx * .35}px, ${dy * .35}px)`;
    lbl.style.transform = `translate(${dx * .12}px, ${dy * .12}px)`;
    btn.style.setProperty('--glow', (1 - dist / R).toFixed(2));
    btn.style.setProperty('--x', `${e.clientX - b.left}px`); btn.style.setProperty('--y', `${e.clientY - b.top}px`);
  });
  stage.addEventListener('pointerleave', rest);
  let timer;
  btn.addEventListener('click', e => {
    const b = btn.getBoundingClientRect(), size = Math.max(b.width, b.height);
    const rip = Object.assign(document.createElement('span'), { className: 'ripple' });
    Object.assign(rip.style, { width: size + 'px', height: size + 'px', left: (e.clientX || b.left + b.width / 2) - b.left - size / 2 + 'px', top: (e.clientY || b.top + b.height / 2) - b.top - size / 2 + 'px' });
    btn.append(rip); setTimeout(() => rip.remove(), 700);
    lbl.textContent = '✓ Thursday 4:30 PM held for you';
    clearTimeout(timer); timer = setTimeout(() => { lbl.textContent = 'Book an appointment →'; }, 2000);
  });
})();

/* ========== 11 hover glitch ========== */
(() => {
  const card = $('#gcard'), face = $('.g0', card);
  ['g1', 'g2'].forEach(cls => {
    const copy = face.cloneNode(true);
    copy.classList.replace('g0', cls); copy.classList.add('gcopy'); copy.setAttribute('aria-hidden', 'true');
    card.append(copy);
  });
  let hovering = false, timer;
  const burst = () => {
    card.classList.add('glitching');
    setTimeout(() => card.classList.remove('glitching'), 420);
    if (hovering) timer = setTimeout(burst, 1100 + Math.random() * 1300);
  };
  const start = () => { if (hovering) return; hovering = true; burst(); };
  const stop = () => { hovering = false; clearTimeout(timer); };
  card.addEventListener('pointerenter', start); card.addEventListener('focus', start);
  card.addEventListener('pointerleave', stop); card.addEventListener('blur', stop);
})();

/* ========== 12 pixel-block transition ========== */
(() => {
  const stage = $('#pix'), grid = $('.pix-grid', stage), btn = $('.replay', stage);
  const cols = 14, rows = 9, sweep = 420;
  grid.style.gridTemplate = `repeat(${rows}, 1fr) / repeat(${cols}, 1fr)`;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = document.createElement('i');
    i.style.setProperty('--d', `${((c + r) / (cols + rows)) * sweep}ms`);
    grid.append(i);
  }
  let busy = false;
  btn.addEventListener('click', async () => {
    if (busy) return; busy = true;
    grid.classList.add('cover');
    await wait(280 + sweep + 40);
    const after = stage.classList.toggle('after');
    btn.textContent = after ? '← Show before' : 'Show after →';
    grid.classList.remove('cover');
    await wait(280 + sweep);
    busy = false;
  });
})();

/* ========== 13 handwritten scribbles ========== */
(() => {
  const stage = $('#scrib');
  [[$('.scribble.circle path', stage), .2], ...$$('.scribble.arrow path', stage).map((p, i) => [p, 1 + i * .35])].forEach(([p, delay]) => {
    p.style.setProperty('--len', p.getTotalLength());
    p.style.setProperty('--delay', delay + 's');
  });
  reveal(stage);
})();

/* ========== 14 live AI receptionist ========== */
(() => {
  const stage = $('#chat'), body = $('.chat-body', stage);
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
      await wait(step.me ? 900 : 300); if (!alive()) return;
      if (step.me) { add('me').textContent = step.me; continue; }
      const typing = add('bot', '<span class="dots"><i></i><i></i><i></i></span>');
      await wait(1000); if (!alive()) return;
      typing.remove();
      const m = add('bot' + (step.confirm ? ' confirm' : '')), txt = document.createElement('span');
      m.append(txt);
      for (let i = 1; i <= step.bot.length; i++) { if (!alive()) return; txt.textContent = step.bot.slice(0, i); await wait(14); }
      if (step.src) m.append(Object.assign(document.createElement('div'), { className: 'src', textContent: step.src }));
      if (step.slots) {
        const row = Object.assign(document.createElement('div'), { className: 'slots' });
        row.innerHTML = step.slots.map(s => `<span>${s}</span>`).join('');
        m.append(row);
        await wait(800); if (!alive()) return;
        row.children[step.pick].classList.add('pick');
      }
    }
    await wait(4500);
    if (alive()) play();
  }
  whenVisible(stage, play, () => run++);
  $('.replay', stage).addEventListener('click', play);
})();

/* ========== 15 exploded layers ========== */
(() => {
  const stage = $('#explode'), btn = $('.replay', stage);
  const set = v => { stage.classList.toggle('open', v); btn.textContent = v ? 'Stack ⤡' : 'Explode ⤢'; };
  stage.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') set(true); });
  stage.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') set(false); });
  btn.addEventListener('click', e => { e.stopPropagation(); set(!stage.classList.contains('open')); });
})();

// Starts a frame loop only while its stage is on screen, so off-screen demos cost nothing.
function loopWhileVisible(stage, frame) {
  let running = false;
  const tick = now => { if (running) { frame(now); requestAnimationFrame(tick); } };
  whenVisible(stage, () => { if (!running) { running = true; requestAnimationFrame(tick); } }, () => { running = false; }, 0.1);
}

/* ========== 16 sparkle cursor trail ========== */
(() => {
  const stage = $('#trail'), canvas = $('canvas', stage);
  const COLORS = ['#14b8a6', '#5eead4', '#fbbf24', '#38bdf8'];
  const sparks = [], path = [];
  let W = 0, H = 0, lastMove = -1e4;
  const ctx = fitCanvas(canvas, (w, h) => { W = w; H = h; });
  const emit = (x, y, n) => {
    for (let i = 0; i < n; i++) sparks.push({
      x, y, vx: (Math.random() - .5) * 2.2, vy: (Math.random() - .5) * 2.2 - .6, life: 1,
      r: 4 + Math.random() * 7, rot: Math.random() * 6, spin: (Math.random() - .5) * .2, c: COLORS[(Math.random() * COLORS.length) | 0],
    });
    path.push({ x, y, life: 1 });
  };
  stage.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    emit(e.clientX - r.left, e.clientY - r.top, 2); lastMove = performance.now();
  });
  const star = (x, y, r, rot) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .28 : r; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  };
  loopWhileVisible(stage, now => {
    if (now - lastMove > 1500) { const t = now / 900; emit(W / 2 + Math.sin(t) * W * .32, H / 2 + Math.sin(t * 2) * H * .22, 1); } // idle: draw a figure-eight
    ctx.clearRect(0, 0, W, H);
    path.forEach(p => { p.life -= .035; });
    while (path.length && path[0].life <= 0) path.shift();
    ctx.lineCap = 'round';
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1], b = path[i];
      ctx.strokeStyle = `rgba(20,184,166,${b.life * .5})`; ctx.lineWidth = b.life * 6;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx; s.y += s.vy; s.vy += .03; s.rot += s.spin; s.life -= .016;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = s.life; ctx.fillStyle = s.c; star(s.x, s.y, s.r * s.life, s.rot);
    }
    ctx.globalAlpha = 1;
  });
})();

/* ========== 17 ASCII portrait ========== */
(() => {
  const stage = $('#ascii'), canvas = $('canvas', stage);
  const RAMP = ' .:-=+*#%@';
  const off = document.createElement('canvas'), oc = off.getContext('2d', { willReadFrequently: true });
  let W = 0, H = 0, fs = 12, cols = 0, rows = 0, base = new Float32Array(0), mx = -1e4, my = -1e4;

  // Draw the tooth at one pixel per character cell, then keep each cell's brightness.
  function build() {
    const cw = fs * .6, ch = fs;
    cols = Math.floor(W / cw); rows = Math.floor(H / ch);
    off.width = cols; off.height = rows;
    oc.fillStyle = '#000'; oc.fillRect(0, 0, cols, rows);
    const sy = rows * .74 / 240, sx = sy * ch / cw;
    oc.save(); oc.translate(cols / 2 - 100 * sx, rows * .53 - 120 * sy); oc.scale(sx, sy);
    const g = oc.createRadialGradient(70, 60, 10, 100, 120, 170);
    g.addColorStop(0, '#fff'); g.addColorStop(.6, '#8a8a8a'); g.addColorStop(1, '#333');
    oc.fillStyle = g; oc.fill(TOOTH);
    oc.lineWidth = 7; oc.strokeStyle = '#fff'; oc.stroke(TOOTH);
    oc.restore();
    const d = oc.getImageData(0, 0, cols, rows).data;
    base = new Float32Array(cols * rows);
    for (let i = 0; i < base.length; i++) base[i] = d[i * 4] / 255;
  }
  const ctx = fitCanvas(canvas, (w, h) => { W = w; H = h; fs = w < 500 ? 9 : 12; build(); });
  stage.addEventListener('pointermove', e => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; });
  stage.addEventListener('pointerleave', () => { mx = my = -1e4; });

  loopWhileVisible(stage, now => {
    const t = now / 1000, cw = fs * .6, tick = (t * 6) | 0;
    ctx.clearRect(0, 0, W, H);
    ctx.font = `${fs}px "Geist Mono", monospace`; ctx.textBaseline = 'top';
    for (let y = 0; y < rows; y++) {
      let dim = '', hot = '';
      for (let x = 0; x < cols; x++) {
        let b = base[y * cols + x];
        if (b > .02) b += .08 * Math.sin(t * 2 + x * .25 + y * .15);                // shimmer
        const d = Math.hypot(x * cw - mx, y * fs - my);
        if (d < 120) b += (1 - d / 120) * .6;                                          // torch
        let chr = RAMP[Math.min(RAMP.length - 1, Math.max(0, (b * RAMP.length) | 0))];
        if (chr === ' ' && (x * 73 + y * 151 + tick * 31) % 97 < 2) chr = '.';           // faint static
        if (b > .78) { hot += chr; dim += ' '; } else { dim += chr; hot += ' '; }
      }
      ctx.fillStyle = '#2dd4bf'; ctx.fillText(dim, 0, y * fs);
      ctx.fillStyle = '#ffffff'; ctx.fillText(hot, 0, y * fs);
    }
  });
})();

/* ========== 18 curved ribbon gallery ========== */
(() => {
  const section = $('#fx-18'), stage = $('#ribbon'), track = $('.ribbon-track', stage), bar = $('.hud-bar i', stage);
  const TEAM = [
    { ini: 'SM', name: 'Dr. Sarah Mansour', sub: 'Founder · whitening & root canal', color: ['#14b8a6', '#0f766e'] },
    { ini: 'KA', name: 'Dr. Karim Adel', sub: 'Fillings · kids · gentle visits', color: ['#0ea5e9', '#1e3a8a'] },
    { ini: 'NF', name: 'Nadia Fawzy', sub: 'Hygienist · cleaning & coaching', color: ['#a78bfa', '#6d28d9'] },
  ];
  const items = [...TEAM, ...SERVICES.map(s => ({ icon: s.icon, name: s.name, sub: `${s.min} min · ${egp(s.price)}`, color: s.color }))];
  track.innerHTML = items.map(it => `<div class="rcard" style="background:linear-gradient(150deg,${it.color[0]},${it.color[1]})">
    <div class="ini">${it.ini || ICONS[it.icon]()}</div><b>${it.name}</b><small>${it.sub}</small></div>`).join('');
  const cards = $$('.rcard', track);
  let p = 0, lastP = 0, speed = 0;
  onPinnedScroll(section, stage, v => { p = v; bar.style.width = v * 100 + '%'; });
  loopWhileVisible(stage, () => {
    const gap = stage.clientWidth < 600 ? 172 : 226;
    speed = lerp(speed, Math.abs(p - lastP) * 60, .12); lastP = p;
    const c = 1 / 1100 + Math.min(speed * .005, 1 / 320); // curvature: a gentle curve, tighter while you scroll fast
    const offset = p * (cards.length - 1) * gap;
    cards.forEach((el, i) => {
      const a = (i * gap - offset) * c;                    // angle around the circle
      const x = Math.sin(a) / c, z = (Math.cos(a) - 1) / c;
      el.style.transform = `translate3d(${x}px, 0, ${z}px) rotateY(${a}rad)`;
      el.style.opacity = clamp((1.55 - Math.abs(a)) * 3);
    });
  });
})();

/* ========== 19 click-to-advance scenes ========== */
(() => {
  const stage = $('#steps'), canvas = $('canvas', stage), label = $('.steps-label', stage), dots = $$('.steps-dots i', stage), btn = $('.steps-btn', stage);
  const STEPS = ['Before: plaque and tartar', 'Step 1 · Scaling lifts the tartar', 'Step 2 · Polishing removes stains', 'Done: smooth, clean, bright'];
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const blobs = Array.from({ length: 26 }, () => ({ x: 38 + rand() * 124, y: 112 + rand() * 42, r: 5 + rand() * 9 }));
  let W = 0, H = 0, state = 0;

  // s runs 0→3: tartar goes during 0→1, stains during 1→2, shine arrives during 2→3.
  function draw(s) {
    const tartar = clamp(1 - s), stain = clamp(2 - s), shine = clamp(s - 2);
    ctx.clearRect(0, 0, W, H);
    const sc = Math.min(W / 200, (H - 120) / 240) * .86;
    const ox = W / 2 - 100 * sc, oy = 50 + (H - 120) / 2 - 110 * sc;
    ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc);
    const fill = ctx.createLinearGradient(0, 0, 0, 200);
    fill.addColorStop(0, stain > 0 ? `rgb(255,${250 - stain * 12},${245 - stain * 40})` : '#fff'); fill.addColorStop(1, '#eaf6f4');
    ctx.fillStyle = fill; ctx.fill(TOOTH);
    ctx.save(); ctx.clip(TOOTH);
    ctx.fillStyle = `rgba(214,178,92,${stain * .55})`;
    blobs.forEach(b => { ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = `rgba(150,112,60,${tartar * .9})`;
    ctx.beginPath(); ctx.moveTo(20, 175);
    for (let x = 20; x <= 180; x += 10) ctx.lineTo(x, 150 + Math.sin(x * .3) * 4);
    ctx.lineTo(180, 175); ctx.fill();
    ctx.restore();
    ctx.lineWidth = 4; ctx.strokeStyle = '#cfe9e5'; ctx.stroke(TOOTH);
    ctx.restore();
    // gums run the full width and hide the roots
    const gum = oy + 166 * sc;
    const gg = ctx.createLinearGradient(0, gum, 0, H);
    gg.addColorStop(0, '#f6a5b8'); gg.addColorStop(1, '#e77f99');
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(0, gum + 14);
    const bump = 100 * sc;
    for (let x = W / 2 - bump * 6; x < W + bump; x += bump) ctx.quadraticCurveTo(x + bump / 2, gum - 10, x + bump, gum + 14);
    ctx.lineTo(W, H); ctx.fill();
    ctx.save(); ctx.translate(ox, oy); ctx.scale(sc, sc);
    if (s > 0 && s < 1) { // scaler sweeps along the gum line
      const x = 40 + s * 120, y = 148 + Math.sin(s * 60) * 3;
      ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 14, y - 24, x + 60, y - 90); ctx.stroke();
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(x + 60, y - 90); ctx.lineTo(x + 100, y - 150); ctx.stroke();
    }
    if (s > 1 && s < 2) { // polishing cup spins across the tooth
      const x = 40 + (s - 1) * 120, y = 120, rot = s * 40;
      ctx.fillStyle = '#5eead4'; ctx.beginPath(); ctx.arc(x, y, 18, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#0f766e'; ctx.lineWidth = 3;
      for (let k = 0; k < 4; k++) { const a = rot + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 16, y + Math.sin(a) * 16); ctx.stroke(); }
      ctx.strokeStyle = '#334155'; ctx.lineWidth = 12; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x + 10, y - 14); ctx.lineTo(x + 70, y - 110); ctx.stroke();
    }
    if (shine > 0) {
      ctx.fillStyle = `rgba(255,255,255,${shine})`;
      ctx.beginPath(); ctx.ellipse(70, 62, 14, 26, -.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(20,184,166,${shine})`;
      [[190, 30, 18], [10, 90, 12], [176, 120, 9]].forEach(([x, y, r]) => {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .25 * shine : r * shine; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
        ctx.fill();
      });
    }
    ctx.restore();
  }
  const ctx = fitCanvas(canvas, (w, h) => { W = w; H = h; draw(state); });

  const setUi = s => {
    label.textContent = STEPS[s];
    dots.forEach((d, i) => d.classList.toggle('on', i <= s));
    btn.textContent = s === 3 ? '↻ Start over' : 'Next step →';
  };
  btn.addEventListener('click', () => {
    if (state === 3) { state = 0; setUi(0); draw(0); return; }
    const from = state, to = state + 1, t0 = performance.now(), dur = 1500;
    btn.disabled = true; label.textContent = STEPS[to];
    (function play(now) { // plays exactly one segment, then stops and waits for the next click
      const k = clamp((now - t0) / dur);
      draw(from + easeInOut(k));
      if (k < 1) return requestAnimationFrame(play);
      state = to; setUi(to); btn.disabled = false;
    })(t0);
  });
})();

/* ========== 20 glass, light & grain ========== */
(() => {
  const stage = $('#glass'), card = $('.gcard2', stage);
  stage.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect(), s = stage.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    const dx = (e.clientX - s.left) / s.width - .5, dy = (e.clientY - s.top) / s.height - .5;
    card.style.transform = `rotateY(${dx * 14}deg) rotateX(${-dy * 14}deg)`;
  });
  stage.addEventListener('pointerleave', () => {
    card.style.transform = ''; card.style.setProperty('--mx', '50%'); card.style.setProperty('--my', '30%');
  });
})();

measurePins();
requestAnimationFrame(tickPins);
