// BrightSmile home prototype: the effects-lab shortlist working together on one page.
// Each block names the lab effect it comes from (trials/001-effects-lab).

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = ms => new Promise(r => setTimeout(r, ms));
const DPR = Math.min(window.devicePixelRatio || 1, 2);
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

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
const TOOTH_D = 'M40 30 C60 5 85 20 100 22 C115 20 140 5 160 30 C182 58 175 105 160 130 C150 150 148 175 142 205 C138 225 122 232 116 210 C110 185 106 165 100 165 C94 165 90 185 84 210 C78 232 62 225 58 205 C52 175 50 150 40 130 C25 105 18 58 40 30 Z';
const TOOTH = new Path2D(TOOTH_D);
const MOUTH_D = 'M40 48 C90 40 120 50 150 52 C180 50 210 40 260 48 C235 98 195 116 150 116 C105 116 65 98 40 48Z';
const line = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
let uid = 0;
const ICONS = {
  toothSolid: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#14b8a6"/></svg>`,
  toothSolidWhite: () => `<svg viewBox="0 0 200 240"><path d="${TOOTH_D}" fill="#fff"/></svg>`,
  chat: () => line('<path d="M4 5h16v11H9l-5 4z"/><path d="M8.5 10.5h.01M12 10.5h.01M15.5 10.5h.01"/>'),
  calendar: () => line('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2"/>'),
  phone: () => line('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>'),
  pin: () => line('<path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/>'),
  smile: () => line('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01"/>'),
  sparkle: () => line('<path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z"/>'),
  shield: () => line('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  pulse: () => line('<path d="M3 12h4l2-5 4 10 2-5h6"/>'),
  extract: () => line('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>'),
  kids: () => line('<circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-6 7-6s7 2 7 6"/>'),
  braces: () => line('<rect x="3" y="9" width="18" height="6" rx="3"/><path d="M7.5 9v6M12 9v6M16.5 9v6"/>'),
  search: () => line('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>'),
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

/* ---------- helpers ---------- */
function whenVisible(el, onIn, onOut, threshold = 0.3) {
  new IntersectionObserver(([e]) => (e.isIntersecting ? onIn() : onOut && onOut()), { threshold }).observe(el);
}
// Runs a frame loop only while the element is on screen.
function loopWhileVisible(el, frame) {
  let running = false;
  const tick = now => { if (running) { frame(now); requestAnimationFrame(tick); } };
  whenVisible(el, () => { if (!running) { running = true; requestAnimationFrame(tick); } }, () => { running = false; }, 0.01);
}
// 0 → 1 as you scroll through a tall section whose inner panel is sticky.
const sectionProgress = (section, offset = 0) => {
  const r = section.getBoundingClientRect();
  return clamp((offset - r.top) / (r.height - innerHeight + offset));
};

/* ---------- smooth inertial scroll (lab: bonus) ---------- */
const smooth = (() => {
  let target = scrollY, current = scrollY, running = false;
  const max = () => document.documentElement.scrollHeight - innerHeight;
  const tick = () => {
    current = lerp(current, target, .09);
    if (Math.abs(target - current) < .4) { current = target; running = false; }
    window.scrollTo(0, current);
    if (running) requestAnimationFrame(tick);
  };
  const start = () => { if (!running) { running = true; requestAnimationFrame(tick); } };
  if (!REDUCED) {
    addEventListener('wheel', e => {
      if (e.ctrlKey) return;
      e.preventDefault();
      target = clamp(target + e.deltaY * (e.deltaMode === 1 ? 40 : 1), 0, max());
      start();
    }, { passive: false });
  }
  addEventListener('scroll', () => { if (!running) target = current = scrollY; });
  return { to(y) { target = clamp(y, 0, max()); current = scrollY; if (REDUCED) window.scrollTo(0, target); else start(); } };
})();
// In-page links glide instead of jumping.
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#"], [data-href]');
  if (!a) return;
  const id = a.getAttribute('href') || a.dataset.href, el = id === '#top' ? document.body : $(id);
  if (!el) return;
  e.preventDefault();
  smooth.to(id === '#top' ? 0 : el.getBoundingClientRect().top + scrollY - 64);
});

/* ---------- hero: letter reveal + scribble (lab 03 + 13) ---------- */
(() => {
  const hero = $('.hero'), h = $('[data-split]', hero);
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
  $$('.scribble path', hero).forEach(p => p.style.setProperty('--len', p.getTotalLength()));
  requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('in')));
})();

/* ---------- hero art: depth layers follow the mouse (lab 08) ---------- */
(() => {
  const art = $('#heroArt'), scene = $('.depth-scene', art);
  const layers = $$('.layer', art).map(el => ({ el, d: +el.dataset.depth }));
  let tx = 0, ty = 0, cx = 0, cy = 0, inside = false;
  addEventListener('pointermove', e => { // the whole hero reacts, not just the picture
    const r = art.getBoundingClientRect();
    tx = clamp(((e.clientX - r.left) / r.width - .5) * 2, -1.4, 1.4);
    ty = clamp(((e.clientY - r.top) / r.height - .5) * 2, -1.4, 1.4);
    inside = e.clientY < r.bottom + 80;
  });
  loopWhileVisible(art, now => {
    if (!inside && !REDUCED) { tx = Math.sin(now / 1400) * .5; ty = Math.cos(now / 1100) * .35; }
    cx = lerp(cx, tx, .06); cy = lerp(cy, ty, .06);
    scene.style.transform = `rotateY(${cx * 6}deg) rotateX(${-cy * 6}deg)`;
    layers.forEach(l => { l.el.style.transform = `translate3d(${cx * l.d * 30}px, ${cy * l.d * 22}px, 0)`; });
  });
})();

/* ---------- magnetic buttons (lab 10) ---------- */
$$('.magnetic').forEach(btn => {
  const lbl = $('.lbl', btn), R = 140;
  const rest = () => { btn.classList.remove('moving'); btn.style.transform = ''; lbl.style.transform = ''; btn.style.setProperty('--glow', 0); };
  addEventListener('pointermove', e => {
    const b = btn.getBoundingClientRect();
    const dx = e.clientX - (b.left + b.width / 2 - (parseFloat(btn.dataset.ox) || 0)), dy = e.clientY - (b.top + b.height / 2 - (parseFloat(btn.dataset.oy) || 0));
    const dist = Math.hypot(dx, dy);
    if (dist > R) { if (btn.classList.contains('moving')) rest(); btn.dataset.ox = btn.dataset.oy = 0; return; }
    const ox = dx * .3, oy = dy * .3;
    btn.dataset.ox = ox; btn.dataset.oy = oy; // remember the offset so the "home" centre stays put
    btn.classList.add('moving');
    btn.style.transform = `translate(${ox}px, ${oy}px)`;
    lbl.style.transform = `translate(${dx * .1}px, ${dy * .1}px)`;
    btn.style.setProperty('--glow', (1 - dist / R).toFixed(2));
    btn.style.setProperty('--x', `${e.clientX - b.left}px`); btn.style.setProperty('--y', `${e.clientY - b.top}px`);
  }, { passive: true });
});

/* ---------- story: scroll-scrubbed tooth + text beats (lab 04 + 05) ---------- */
(() => {
  const section = $('#story'), canvas = $('canvas', section), ctx = canvas.getContext('2d');
  const beats = $$('.beat', section), rail = $('.story-rail i', section);
  let W = 0, H = 0, last = -1;

  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const shards = [];
  const cols = 5, rows = 6, cw = 220 / cols, ch = 260 / rows;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = -10 + c * cw, y = -10 + r * ch;
    for (const tri of [[[x, y], [x + cw, y], [x, y + ch]], [[x + cw, y], [x + cw, y + ch], [x, y + ch]]]) {
      const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3, cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
      const a = rand() * Math.PI * 2, d = 260 + rand() * 280;
      shards.push({ pts: tri.map(([px, py]) => [cx + (px - cx) * 1.03, cy + (py - cy) * 1.03]), cx, cy, dx: Math.cos(a) * d, dy: Math.sin(a) * d, rot: (rand() - .5) * 5, delay: rand() * .4 });
    }
  }
  const mix = (a, b, t) => {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
    return `rgb(${lerp(r1, r2, t) | 0},${lerp(g1, g2, t) | 0},${lerp(b1, b2, t) | 0})`;
  };
  const star = (x, y, r) => {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, rr = i % 2 ? r * .22 : r; ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fill();
  };

  // On the live site these would be ~150 AI-video frames; here each frame is drawn on demand.
  function draw(t) {
    const wide = W > 860, cxs = wide ? W * .68 : W / 2, cys = wide ? H * .5 : H * .36;
    const g = ctx.createRadialGradient(cxs, cys, 0, cxs, cys, Math.max(W, H) * .7);
    g.addColorStop(0, mix('#12345f', '#2aa8a0', .15 + .55 * t)); g.addColorStop(.5, '#12345f'); g.addColorStop(1, '#0b2545');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    const s = Math.min(wide ? W * .36 / 200 : W * .66 / 200, (wide ? H * .6 : H * .46) / 240);
    ctx.save(); ctx.translate(cxs - 100 * s, cys - 120 * s); ctx.scale(s, s);
    const white = easeInOut(clamp((t - .45) / .5));
    const fill = ctx.createLinearGradient(0, 0, 0, 240);
    fill.addColorStop(0, mix('#d9c48a', '#ffffff', white)); fill.addColorStop(1, mix('#b89e5c', '#d8f3ef', white));
    for (const sh of shards) {
      const k = 1 - easeOut(clamp((t - sh.delay) / .55));
      ctx.save();
      ctx.globalAlpha = clamp(1.15 - k * 1.1);
      ctx.translate(sh.cx + sh.dx * k, sh.cy + sh.dy * k); ctx.rotate(sh.rot * k); ctx.translate(-sh.cx, -sh.cy);
      ctx.beginPath(); ctx.moveTo(...sh.pts[0]); ctx.lineTo(...sh.pts[1]); ctx.lineTo(...sh.pts[2]); ctx.closePath(); ctx.clip();
      ctx.fillStyle = fill; ctx.fill(TOOTH);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(94,234,212,.9)'; ctx.stroke(TOOTH);
      ctx.restore();
    }
    if (t > .95) {
      ctx.shadowColor = `rgba(94,234,212,${(t - .95) * 14})`; ctx.shadowBlur = 50;
      ctx.fillStyle = fill; ctx.fill(TOOTH); ctx.shadowBlur = 0;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(94,234,212,.9)'; ctx.stroke(TOOTH);
    }
    if (t > .82) {
      const k = easeOut((t - .82) / .18);
      ctx.fillStyle = `rgba(255,255,255,${.85 * k})`;
      ctx.beginPath(); ctx.ellipse(70, 62, 14 * k, 26 * k, -.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${k})`;
      star(196, 20, 20 * k); star(8, 120, 13 * k); star(182, 168, 10 * k);
    }
    ctx.restore();
  }
  new ResizeObserver(() => {
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); last = -1;
  }).observe(canvas);

  loopWhileVisible(section, () => {
    const p = sectionProgress(section);
    if (Math.abs(p - last) < .0005 || !W) return;
    last = p;
    draw(clamp(p * 1.15));
    beats.forEach((b, i) => { // each beat owns a third of the scroll, crossfading at the edges
      const d = (p - (i + .5) / beats.length) * beats.length;
      let o = clamp(1 - (Math.abs(d) - .32) * 5.5);
      if ((i === 0 && d < 0) || (i === beats.length - 1 && d > 0)) o = 1;
      b.style.opacity = o; b.style.transform = `translateY(${-d * 50}px)`;
    });
    rail.style.width = p * 100 + '%';
  });
})();

/* ---------- services: cursor-follow preview (lab 09) ---------- */
(() => {
  const list = $('#plist'), card = $('#preview'), art = $('.preview-art', card), body = $('.preview-body', card);
  let tx = 0, ty = 0, cx = 0, cy = 0;
  SERVICES.forEach(s => {
    const b = document.createElement('button');
    b.innerHTML = `<span class="n">${s.name}</span><span class="m">${s.min} min · <b>${egp(s.price)}</b></span>`;
    const show = () => {
      $$('button', list).forEach(x => x.classList.toggle('on', x === b));
      list.classList.add('hovering'); card.classList.add('show');
      art.style.background = `linear-gradient(140deg, ${s.color[0]}, ${s.color[1]})`;
      art.innerHTML = ICONS[s.icon]();
      body.innerHTML = `<strong>${s.name}</strong>${s.who}`;
    };
    b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(); });
    b.addEventListener('focus', () => {
      show();
      const r = b.getBoundingClientRect(), lr = list.getBoundingClientRect();
      tx = lr.width - 250; ty = r.top - lr.top - 40;
    });
    b.addEventListener('click', () => smooth.to($('#assistant').getBoundingClientRect().top + scrollY - 64));
    list.append(b);
  });
  const hide = () => { list.classList.remove('hovering'); card.classList.remove('show'); $$('button', list).forEach(x => x.classList.remove('on')); };
  list.addEventListener('pointerleave', hide);
  list.addEventListener('focusout', e => { if (!list.contains(e.relatedTarget)) hide(); });
  list.addEventListener('pointermove', e => {
    const r = list.getBoundingClientRect();
    tx = Math.min(e.clientX - r.left + 24, r.width - 240); ty = e.clientY - r.top - 60;
  });
  loopWhileVisible(list, () => {
    cx = lerp(cx, tx, .14); cy = lerp(cy, ty, .14);
    card.style.translate = `${cx}px ${cy}px`;
  });
})();

/* ---------- how it works: scroll-drawn journey (lab 27) ---------- */
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
  svg.innerHTML = `<path class="base" d="${D}"/><path class="prog" d="${D}"/><g class="nodes"></g>
    <g class="marker"><circle class="halo" r="26"/><circle r="11"/></g>`;
  const prog = $('.prog', svg), len = prog.getTotalLength(), marker = $('.marker', svg);
  prog.style.strokeDasharray = len;
  const nodes = STOPS.map(([f, title, sub]) => {
    const pt = prog.getPointAtLength(len * f), right = pt.x <= 300;
    const lx = right ? pt.x + 28 : pt.x - 28, anchor = right ? 'start' : 'end';
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
    const p = clamp(sectionProgress(section, 64) * 1.08);
    prog.style.strokeDashoffset = len * (1 - p);
    const pt = prog.getPointAtLength(len * p);
    marker.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
    nodes.forEach(n => n.g.classList.toggle('on', p >= n.f - .005));
    const box = svg.getBoundingClientRect(), k = box.width / 600;
    pan = lerp(pan, clamp(pt.y * k - win.clientHeight / 2, 0, Math.max(0, box.height - win.clientHeight)), .12);
    svg.style.transform = `translateY(${-pan}px)`;
  });
})();

/* ---------- assistant: scripted live chat (lab 14) ---------- */
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
    await wait(5000);
    if (alive()) play();
  }
  whenVisible(chat, play, () => run++, 0.4);
})();

/* ---------- results: before / after with a spring (lab 24) ---------- */
(() => {
  const stage = $('#compare'), handle = $('.cmp-handle', stage);
  let target = 50, pos = 50, vel = 0, dragging = false;
  const fromEvent = e => { const r = stage.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width * 100, 0, 100); };
  stage.addEventListener('pointerdown', e => {
    dragging = true; target = fromEvent(e);
    try { stage.setPointerCapture(e.pointerId); } catch { /* keeps working without capture */ }
  });
  stage.addEventListener('pointermove', e => { if (dragging) target = fromEvent(e); });
  ['pointerup', 'pointercancel'].forEach(t => stage.addEventListener(t, () => { dragging = false; }));
  handle.addEventListener('keydown', e => {
    const step = { ArrowLeft: -5, ArrowRight: 5, Home: -100, End: 100 }[e.key];
    if (step === undefined) return;
    e.preventDefault(); target = clamp(target + step, 0, 100);
  });
  loopWhileVisible(stage, () => {
    vel = (vel + (target - pos) * .18) * .64; pos += vel;
    stage.style.setProperty('--pos', `${pos}%`);
    const squash = Math.min(Math.abs(vel) * .05, .35);
    handle.style.setProperty('--sx', 1 + squash); handle.style.setProperty('--sy', 1 - squash * .6);
    handle.setAttribute('aria-valuenow', Math.round(target));
  });
  let hinted = false;
  whenVisible(stage, async () => {
    if (hinted) return; hinted = true;
    for (const t of [30, 70, 50]) { await wait(500); if (!dragging) target = t; }
  }, null, 0.6);
})();

/* ---------- reviews: swipeable deck (lab 25) ---------- */
(() => {
  const section = $('#reviews'), wrap = $('.deck-cards', section), count = $('.deck-count', section);
  const REVIEWS = [
    { q: 'I was terrified of dentists. Dr. Karim talked me through every step and I felt nothing.', who: 'Mariam A.', what: 'Tooth filling', c: '#14b8a6' },
    { q: 'Booked at midnight through the chat, got a reminder the day before. Zero phone calls.', who: 'Omar K.', what: 'Check-up', c: '#0ea5e9' },
    { q: 'The whitening result was better than the photos. Two shades brighter in one visit.', who: 'Laila S.', what: 'Teeth whitening', c: '#f59e0b' },
    { q: 'My son actually asks when the next visit is. That says everything.', who: 'Youssef H.', what: "Children's check-up", c: '#22c55e' },
    { q: 'Root canal without the horror stories. Calm, quick, and the price was exactly as quoted.', who: 'Hana M.', what: 'Root canal', c: '#a855f7' },
  ];
  wrap.innerHTML = REVIEWS.map((r, i) => `<article class="rv" data-i="${i}">
    <div class="stars" aria-label="5 out of 5 stars">★★★★★</div><q>${r.q}</q>
    <div class="who"><span class="av" style="background:${r.c}">${r.who[0]}</span><span><b>${r.who}</b><small>${r.what}</small></span></div></article>`).join('');
  const order = $$('.rv', wrap);
  let busy = false;
  const layout = (lift = 0) => order.forEach((el, i) => {
    el.style.zIndex = order.length - i;
    if (i === 0) return;
    const k = Math.max(0, i - lift);
    el.style.transform = `translateY(${k * 14}px) scale(${1 - k * .05}) rotate(${(i % 2 ? 1 : -1) * k * 2}deg)`;
    el.style.opacity = i > 3 ? 0 : 1;
  });
  const setTop = (x, y, rot, spring) => {
    const el = order[0];
    el.style.transition = spring ? 'transform .55s cubic-bezier(.2,1.6,.4,1)' : 'none';
    el.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`;
  };
  const updateCount = () => { count.textContent = `${+order[0].dataset.i + 1} / ${REVIEWS.length}`; };
  function fly(dir) {
    if (busy) return; busy = true;
    const el = order[0];
    el.style.transition = 'transform .45s cubic-bezier(.4,0,.8,.6), opacity .45s';
    el.style.transform = `translate(${dir * innerWidth * .7}px, -40px) rotate(${dir * 28}deg)`;
    el.style.opacity = 0;
    order.push(order.shift());
    order.forEach(c => { if (c !== el) c.style.transition = ''; });
    order[0].style.transform = 'none'; order[0].style.opacity = 1;
    layout(); updateCount();
    setTimeout(() => { el.style.transition = 'none'; layout(); void el.offsetWidth; el.style.transition = ''; busy = false; }, 460);
  }
  let sx = 0, sy = 0, dx = 0, lastX = 0, lastT = 0, vx = 0, dragging = false;
  wrap.addEventListener('pointerdown', e => {
    const el = e.target.closest('.rv');
    if (el !== order[0] || busy) return;
    sx = lastX = e.clientX; sy = e.clientY; lastT = e.timeStamp; vx = 0; dragging = true;
    try { el.setPointerCapture(e.pointerId); } catch { /* keeps working without capture */ }
    order.slice(1).forEach(c => { c.style.transition = 'none'; });
  });
  wrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    dx = e.clientX - sx;
    vx = (e.clientX - lastX) / Math.max(1, e.timeStamp - lastT); lastX = e.clientX; lastT = e.timeStamp;
    setTop(dx, (e.clientY - sy) * .4, dx * .06, false);
    layout(Math.min(Math.abs(dx) / 120, 1));
  });
  const release = () => {
    if (!dragging) return; dragging = false;
    order.slice(1).forEach(c => { c.style.transition = ''; });
    if (Math.abs(dx) > 110 || Math.abs(vx) > .6) fly(Math.sign(dx || vx));
    else { setTop(0, 0, 0, true); layout(); }
    dx = 0;
  };
  wrap.addEventListener('pointerup', release); wrap.addEventListener('pointercancel', release);
  $$('.deck-ui button', section).forEach(b => b.addEventListener('click', () => fly(+b.dataset.dir)));
  layout(); updateCount();
})();

/* ---------- book: glass card tilts toward the cursor (lab 20) ---------- */
(() => {
  const section = $('#book'), card = $('#glass');
  section.addEventListener('pointermove', e => {
    const r = card.getBoundingClientRect(), s = section.getBoundingClientRect();
    card.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    card.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
    const dx = (e.clientX - s.left) / s.width - .5, dy = (e.clientY - s.top) / s.height - .5;
    card.style.transform = `rotateY(${dx * 10}deg) rotateX(${-dy * 10}deg)`;
  });
  section.addEventListener('pointerleave', () => { card.style.transform = ''; });
})();

/* ---------- footer: giant name rises in (lab 02) ---------- */
whenVisible($('#giant'), () => $('#giant').classList.add('in'), null, 0.2);

/* ---------- floating contact: gooey menu (lab 30) ---------- */
(() => {
  const fab = $('#fab'), btn = $('.goo-icons .main', fab);
  const blobs = $$('.goo-blobs .opt', fab), icons = $$('.goo-icons .opt', fab);
  // Options stack straight up from the corner, labels to their left.
  const place = open => {
    [blobs, icons].forEach(list => list.forEach((el, i) => {
      el.style.setProperty('--k', open ? i : list.length - 1 - i);
      el.style.transform = open ? `translate(0, ${-(72 + i * 64)}px)` : '';
    }));
  };
  const toggle = open => { fab.classList.toggle('open', open); btn.setAttribute('aria-expanded', open); place(open); };
  btn.addEventListener('click', () => toggle(!fab.classList.contains('open')));
  icons.forEach((ic, i) => {
    ic.addEventListener('pointerenter', () => { blobs[i].style.scale = '1.15'; });
    ic.addEventListener('pointerleave', () => { blobs[i].style.scale = ''; });
    ic.addEventListener('click', () => toggle(false));
  });
})();
