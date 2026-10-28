// Part 3 of the effects lab: effects 21–30 (raw WebGL, physics, scroll cinema).
// Uses the helpers defined in app.js: $, $$, clamp, lerp, easing, ICONS, SERVICES, onPinnedScroll, loopWhileVisible…

/* ---------- tiny WebGL helper: one full-screen rectangle, one fragment shader ---------- */
function glQuad(canvas, fragSrc) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false });
  if (!gl) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v_uv; void main() { v_uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }'));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const cache = {};
  return {
    gl,
    u: name => (cache[name] ??= gl.getUniformLocation(prog, name)),
    texture(unit, source, name) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform1i(this.u(name), unit);
    },
    resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = Math.round(w * DPR); canvas.height = Math.round(h * DPR);
      gl.viewport(0, 0, canvas.width, canvas.height);
      return [w, h];
    },
    draw() { gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); },
  };
}
const noGL = stage => stage.insertAdjacentHTML('beforeend', '<p class="nogl">WebGL is turned off in this browser, so this demo cannot run.</p>');
// "Cover" fit for a shader: how much of the picture to show so it fills the box without stretching.
const coverScale = (w, h, tw, th) => { const a = w / h, t = tw / th; return a > t ? [1, t / a] : [a / t, 1]; };
const svgImage = markup => new Promise(res => {
  const img = new Image();
  img.onload = () => res(img);
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(markup.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
});
const makeCanvas = (w, h) => Object.assign(document.createElement('canvas'), { width: w, height: h });

/* ========== 21 depth-map 2.5D ========== */
(() => {
  const stage = $('#depthmap'), canvas = $('canvas', stage);
  const q = glQuad(canvas, `precision mediump float;
    uniform sampler2D u_img, u_depth;
    uniform vec2 u_mouse, u_scale;
    uniform float u_view;
    varying vec2 v_uv;
    void main() {
      vec2 uv = (v_uv - .5) * u_scale * .93 + .5;
      float d = texture2D(u_depth, uv).r;          // 1 = near, 0 = far
      vec2 uv2 = uv + u_mouse * (d - .4) * .05;
      d = texture2D(u_depth, uv2).r;               // look again where we landed: smoother edges
      uv2 = uv + u_mouse * (d - .4) * .05;
      vec3 c = texture2D(u_img, uv2).rgb;
      gl_FragColor = vec4(mix(c, vec3(d), u_view), 1.);
    }`);
  if (!q) return noGL(stage);

  const TW = 1200, TH = 750, g = v => `rgb(${v},${v},${v})`;
  const color = makeCanvas(TW, TH), depth = makeCanvas(TW, TH), cc = color.getContext('2d'), dc = depth.getContext('2d');
  // Turns an image into a flat grey shape of itself, for the depth map.
  const silhouette = (img, w, h, fill) => {
    const t = makeCanvas(w, h), tc = t.getContext('2d');
    tc.drawImage(img, 0, 0, w, h);
    tc.globalCompositeOperation = 'source-in'; tc.fillStyle = fill; tc.fillRect(0, 0, w, h);
    return t;
  };
  const WINDOWS = [[110, 60, 300, 400], [790, 60, 300, 400]];
  const BUBBLES = [[270, 170, 34], [940, 140, 24], [1030, 420, 40], [160, 500, 28], [700, 110, 18], [560, 600, 14]];
  let ready = false;

  Promise.all([svgImage(ICONS.mascot()), svgImage(ICONS.brush()), svgImage(ICONS.floss())]).then(([mascot, brush, floss]) => {
    // the colour picture
    let gr = cc.createLinearGradient(0, 0, 0, TH);
    gr.addColorStop(0, '#cdf3ec'); gr.addColorStop(1, '#ffffff');
    cc.fillStyle = gr; cc.fillRect(0, 0, TW, TH);
    cc.fillStyle = 'rgba(255,255,255,.8)';
    WINDOWS.forEach(([x, y, w, h]) => { cc.beginPath(); cc.roundRect(x, y, w, h, [150, 150, 16, 16]); cc.fill(); });
    cc.fillStyle = '#bfe9e2'; cc.beginPath(); cc.ellipse(600, 700, 540, 90, 0, 0, Math.PI * 2); cc.fill();
    BUBBLES.forEach(([x, y, r]) => {
      cc.fillStyle = 'rgba(255,255,255,.95)'; cc.strokeStyle = 'rgba(20,184,166,.5)'; cc.lineWidth = 4;
      cc.beginPath(); cc.arc(x, y, r, 0, Math.PI * 2); cc.fill(); cc.stroke();
    });
    cc.drawImage(floss, 140, 420, 200, 240);
    cc.save(); cc.shadowColor = 'rgba(15,118,110,.28)'; cc.shadowBlur = 50; cc.shadowOffsetY = 30;
    cc.drawImage(mascot, 400, 130, 400, 480); cc.restore();
    cc.save(); cc.translate(910, 600); cc.rotate(-.5); cc.drawImage(brush, -230, -46, 460, 92); cc.restore();

    // the depth map: same shapes, painted by distance (white = near)
    gr = dc.createLinearGradient(0, 0, 0, TH);
    gr.addColorStop(0, g(8)); gr.addColorStop(1, g(80));
    dc.fillStyle = gr; dc.fillRect(0, 0, TW, TH);
    dc.fillStyle = g(28);
    WINDOWS.forEach(([x, y, w, h]) => { dc.beginPath(); dc.roundRect(x, y, w, h, [150, 150, 16, 16]); dc.fill(); });
    dc.fillStyle = g(100); dc.beginPath(); dc.ellipse(600, 700, 540, 90, 0, 0, Math.PI * 2); dc.fill();
    dc.fillStyle = g(120);
    BUBBLES.forEach(([x, y, r]) => { dc.beginPath(); dc.arc(x, y, r + 2, 0, Math.PI * 2); dc.fill(); });
    dc.drawImage(silhouette(floss, 200, 240, g(160)), 140, 420);
    const m = silhouette(mascot, 400, 480, '#fff'), mc = m.getContext('2d');
    const rg = mc.createRadialGradient(185, 200, 20, 200, 250, 270);  // rounded: brightest in the middle
    rg.addColorStop(0, g(255)); rg.addColorStop(1, g(150));
    mc.globalCompositeOperation = 'source-in'; mc.fillStyle = rg; mc.fillRect(0, 0, 400, 480);
    dc.drawImage(m, 400, 130);
    dc.save(); dc.translate(910, 600); dc.rotate(-.5); dc.drawImage(silhouette(brush, 460, 92, g(245)), -230, -46); dc.restore();
    // soften the map so pixels bend instead of tearing at edges
    const soft = makeCanvas(TW, TH), sc = soft.getContext('2d');
    sc.filter = 'blur(10px)'; sc.drawImage(depth, 0, 0);

    q.texture(0, color, 'u_img'); q.texture(1, soft, 'u_depth');
    ready = true; size();
  });

  let W = 0, H = 0, tx = 0, ty = 0, mx = 0, my = 0, inside = false, view = 0, viewTarget = 0;
  const size = () => { [W, H] = q.resize(); if (ready) q.gl.uniform2fv(q.u('u_scale'), coverScale(W, H, TW, TH)); };
  new ResizeObserver(size).observe(canvas);
  stage.addEventListener('pointermove', e => {
    const r = stage.getBoundingClientRect();
    tx = ((e.clientX - r.left) / r.width - .5) * 2; ty = -((e.clientY - r.top) / r.height - .5) * 2; inside = true;
  });
  stage.addEventListener('pointerleave', () => { inside = false; });
  $$('.seg button', stage).forEach(b => b.addEventListener('click', () => {
    viewTarget = +b.dataset.view;
    $$('.seg button', stage).forEach(x => x.classList.toggle('on', x === b));
  }));
  loopWhileVisible(stage, now => {
    if (!ready) return;
    if (!inside) { tx = Math.sin(now / 1600) * .6; ty = Math.cos(now / 1300) * .4; }
    mx = lerp(mx, tx, .06); my = lerp(my, ty, .06); view = lerp(view, viewTarget, .12);
    q.gl.uniform2f(q.u('u_mouse'), mx, my); q.gl.uniform1f(q.u('u_view'), view);
    q.draw();
  });
})();

/* ========== 22 liquid ripple ========== */
(() => {
  const stage = $('#ripple'), canvas = $('canvas', stage), MAX = 12;
  const q = glQuad(canvas, `precision mediump float;
    uniform sampler2D u_img;
    uniform vec4 u_r[${MAX}];          // each ripple: x, y, start time, strength
    uniform float u_t, u_aspect;
    uniform vec2 u_scale;
    varying vec2 v_uv;
    void main() {
      vec2 off = vec2(0.); float crest = 0.;
      for (int i = 0; i < ${MAX}; i++) {
        vec4 r = u_r[i];
        float age = u_t - r.z;
        if (age < 0. || age > 4.) continue;
        vec2 dv = v_uv - r.xy; dv.x *= u_aspect;
        float d = length(dv);
        float ring = d - age * .32;                                   // the ring grows outward
        float w = sin(ring * 70.) * exp(-abs(ring) * 22.) * exp(-age * 1.3) * r.w;
        off += dv / (d + .0001) * w * .014;
        crest += w;
      }
      vec2 uv = (v_uv - .5) * u_scale + .5 + off;
      gl_FragColor = vec4(texture2D(u_img, uv).rgb + crest * .16, 1.);
    }`);
  if (!q) return noGL(stage);

  const TW = 1200, TH = 750, tex = makeCanvas(TW, TH), c = tex.getContext('2d');
  let ready = false;
  document.fonts.ready.then(() => {
    const gr = c.createLinearGradient(0, 0, TW, TH);
    gr.addColorStop(0, '#0f766e'); gr.addColorStop(.55, '#12345f'); gr.addColorStop(1, '#0b2545');
    c.fillStyle = gr; c.fillRect(0, 0, TW, TH);
    let seed = 11;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      c.strokeStyle = `rgba(94,234,212,${.03 + rand() * .07})`; c.lineWidth = 1 + rand() * 3;
      c.beginPath(); c.arc(rand() * TW, rand() * TH, 20 + rand() * 160, 0, Math.PI * 2); c.stroke();
    }
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = '#fff'; c.font = '800 118px Geist, system-ui, sans-serif';
    c.fillText('Fresh as mint.', TW / 2, TH / 2 - 30);
    c.fillStyle = 'rgba(94,234,212,.95)'; c.font = '600 26px "Geist Mono", monospace';
    c.fillText('PROFESSIONAL CLEANING · 800 EGP', TW / 2, TH / 2 + 62);
    c.fillStyle = 'rgba(255,255,255,.55)'; c.font = '500 21px "Geist Mono", monospace';
    c.fillText('hover to make waves · click to splash', TW / 2, TH - 90);
    q.texture(0, tex, 'u_img');
    ready = true;
  });

  const rip = new Float32Array(MAX * 4);
  for (let i = 0; i < MAX; i++) rip[i * 4 + 2] = -100; // empty slots count as long finished
  let next = 0, W = 0, H = 0, lastDrop = 0, lastX = -1, lastY = -1;
  const t0 = performance.now(), clock = () => (performance.now() - t0) / 1000;
  const drop = (x, y, s) => { rip.set([x, y, clock(), s], next * 4); next = (next + 1) % MAX; lastDrop = clock(); };
  const toUv = e => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height]; };
  stage.addEventListener('pointermove', e => {
    const [x, y] = toUv(e);
    if (Math.hypot((x - lastX) * W, (y - lastY) * H) > 28 && clock() - lastDrop > .07) { drop(x, y, .55); lastX = x; lastY = y; }
  });
  stage.addEventListener('pointerdown', e => { const [x, y] = toUv(e); drop(x, y, 1.4); });
  new ResizeObserver(() => {
    [W, H] = q.resize();
    q.gl.uniform1f(q.u('u_aspect'), W / H); q.gl.uniform2fv(q.u('u_scale'), coverScale(W, H, TW, TH));
  }).observe(canvas);
  loopWhileVisible(stage, () => {
    if (!ready) return;
    if (clock() - lastDrop > 1.8) drop(.2 + Math.random() * .6, .25 + Math.random() * .5, .9); // a drop now and then when idle
    q.gl.uniform1f(q.u('u_t'), clock()); q.gl.uniform4fv(q.u('u_r'), rip);
    q.draw();
  });
})();

/* ========== 23 X-ray flashlight ========== */
(() => {
  const stage = $('#xray'), lens = $('.xr-lens', stage);
  const XS = [175, 305, 435, 565, 695, 825], S = .62, TOP = 150;
  const tooth = (x, attrs) => `<path d="${TOOTH_D}" transform="translate(${x - 100 * S} ${TOP}) scale(${S})" ${attrs}/>`;
  const pulp = (x, fill, extra = '') => `<path d="${TOOTH_D}" transform="translate(${x - 100 * S * .5} ${TOP + 38}) scale(${S * .5} ${S * .72})" fill="${fill}" ${extra}/>`;
  // Gum (and, in the X-ray, bone) line: peaks between teeth, dips at each tooth.
  const GUM = 'M0 600 L0 238 L110 238 ' + XS.map(x => `Q${x} 292 ${x + 65} 238`).join(' ') + ' L1000 238 L1000 600 Z';
  const svg = body => `<svg viewBox="0 0 1000 560" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

  $('.xr-smile', stage).innerHTML = svg(`
    <defs>
      <linearGradient id="smBg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6faf7"/><stop offset="1" stop-color="#fff"/></linearGradient>
      <linearGradient id="smTooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#e3f1ef"/></linearGradient>
      <linearGradient id="smGum" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6a5b8"/><stop offset="1" stop-color="#e57d97"/></linearGradient>
    </defs>
    <rect x="-200" y="-200" width="1400" height="960" fill="url(#smBg)"/>
    <text x="500" y="92" text-anchor="middle" font-family="Geist, sans-serif" font-weight="750" font-size="40" fill="#0b2545">Looks healthy, right?</text>
    ${XS.map(x => tooth(x, 'fill="url(#smTooth)" stroke="#cfe9e5" stroke-width="5"')).join('')}
    <path d="${GUM}" fill="url(#smGum)"/>
    <text x="500" y="440" text-anchor="middle" font-family="Geist Mono, monospace" font-size="20" fill="#fff" opacity=".9">sweep the lens across the teeth</text>`);

  $('.xr-ray', stage).innerHTML = svg(`
    <defs>
      <radialGradient id="xrBg" cx=".5" cy=".45" r=".75"><stop offset="0" stop-color="#1b2838"/><stop offset="1" stop-color="#05080d"/></radialGradient>
      <linearGradient id="xrTooth" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f1f6fb"/><stop offset=".55" stop-color="#b6c4d3"/><stop offset="1" stop-color="#7c8b9e"/></linearGradient>
      <filter id="xrGlow"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="xrSoft"><feGaussianBlur stdDeviation="2.5"/></filter>
      <pattern id="xrScan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="rgba(255,255,255,.05)"/></pattern>
    </defs>
    <rect x="-200" y="-200" width="1400" height="960" fill="url(#xrBg)"/>
    <text x="500" y="92" text-anchor="middle" font-family="Geist, sans-serif" font-weight="750" font-size="40" fill="#5eead4">What Dr. Sarah sees</text>
    <path d="${GUM}" fill="#3a4a5e" opacity=".55"/>
    <g filter="url(#xrGlow)" opacity=".93">${XS.map(x => tooth(x, 'fill="url(#xrTooth)" stroke="rgba(255,255,255,.55)" stroke-width="3"')).join('')}</g>
    ${XS.map((x, i) => (i === 3 ? pulp(x, '#ffffff', 'filter="url(#xrGlow)"') : pulp(x, '#253244'))).join('')}
    <ellipse cx="${XS[1] + 18}" cy="${TOP + 40}" rx="15" ry="10" fill="#070b11" filter="url(#xrSoft)"/>
    <rect x="${XS[4] - 26}" y="${TOP + 22}" width="52" height="26" rx="12" fill="#fff" filter="url(#xrGlow)"/>
    <g font-family="Geist Mono, monospace" font-size="21" fill="#5eead4" stroke-width="2">
      <path d="M${XS[1] + 30} ${TOP + 34} L${XS[1] + 70} 128" stroke="#5eead4"/><text x="${XS[1] + 76}" y="124">early cavity</text>
      <path d="M${XS[4] + 24} ${TOP + 30} L${XS[4] + 64} 128" stroke="#5eead4"/><text x="${XS[4] + 70}" y="124">old filling</text>
      <path d="M${XS[3]} ${TOP + 150} L${XS[3]} 460" stroke="#5eead4"/><text x="${XS[3]}" y="488" text-anchor="middle">treated root</text>
    </g>
    <rect x="-200" y="-200" width="1400" height="960" fill="url(#xrScan)"/>`);

  let tx = 0, ty = 0, x = 0, y = 0, inside = false;
  stage.addEventListener('pointermove', e => { const r = stage.getBoundingClientRect(); tx = e.clientX - r.left; ty = e.clientY - r.top; inside = true; });
  stage.addEventListener('pointerleave', () => { inside = false; });
  loopWhileVisible(stage, now => {
    const w = stage.clientWidth, h = stage.clientHeight, R = w < 520 ? 84 : 130;
    if (!inside) { tx = w / 2 + Math.sin(now / 1500) * w * .33; ty = h * .45 + Math.sin(now / 1100) * h * .12; } // lens wanders on its own
    x = lerp(x, tx, .14); y = lerp(y, ty, .14);
    stage.style.setProperty('--x', `${x}px`); stage.style.setProperty('--y', `${y}px`); stage.style.setProperty('--r', `${R}px`);
    lens.style.transform = `translate(${x - R}px, ${y - R}px)`;
  });
})();

/* ========== 24 before / after slider ========== */
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
    vel = (vel + (target - pos) * .18) * .64; // spring: pulled toward the target, loses a bit of speed every frame
    pos += vel;
    stage.style.setProperty('--pos', `${pos}%`);
    const squash = Math.min(Math.abs(vel) * .05, .35);
    handle.style.setProperty('--sx', 1 + squash); handle.style.setProperty('--sy', 1 - squash * .6);
    handle.setAttribute('aria-valuenow', Math.round(target));
  });
  // A small wiggle the first time it comes into view, so people see it can move.
  let hinted = false;
  whenVisible(stage, async () => {
    if (hinted) return; hinted = true;
    for (const t of [30, 70, 50]) { await wait(480); if (!dragging) target = t; }
  });
})();

/* ========== 25 swipeable review deck ========== */
(() => {
  const stage = $('#deck'), wrap = $('.deck-cards', stage), count = $('.deck-count', stage);
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
  let order = $$('.rv', wrap), busy = false;

  // Stack the cards; `lift` (0→1) raises the ones underneath while the top card is dragged.
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
    el.style.transform = `translate(${dir * stage.clientWidth}px, -40px) rotate(${dir * 28}deg)`;
    el.style.opacity = 0;
    order.push(order.shift());
    order.forEach(c => { if (c !== el) c.style.transition = ''; });
    order[0].style.transform = 'none';
    layout(); updateCount();
    setTimeout(() => { // the thrown card quietly rejoins the back of the stack
      el.style.transition = 'none'; layout(); void el.offsetWidth; el.style.transition = ''; busy = false;
    }, 460);
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
  $$('.deck-ui button', stage).forEach(b => b.addEventListener('click', () => fly(+b.dataset.dir)));
  layout(); updateCount();
})();

/* ========== 26 zoom-through portal ========== */
(() => {
  const section = $('#fx-26'), stage = $('#portal'), scene = $('.portal-scene', stage), copy = $('.portal-copy', stage);
  const holes = $$('.ph', stage), ring = $('.ph-ring', stage);
  holes.forEach(p => p.setAttribute('d', TOOTH_D));
  onPinnedScroll(section, stage, p => {
    const s = 1.1 * Math.pow(48, Math.pow(clamp(p / .9), 1.4)); // exponential growth reads as flying at a steady speed
    holes.forEach(el => el.setAttribute('transform', `translate(500 250) scale(${s}) translate(-100 -80)`));
    ring.style.opacity = clamp(1 - p * 1.6);
    scene.style.transform = `scale(${1.25 - .25 * easeOut(p)})`;
    copy.style.opacity = clamp(1 - p * 3);
    copy.style.transform = `scale(${1 + p * 1.5})`;
  });
})();

/* ========== 27 scroll-drawn journey ========== */
(() => {
  const section = $('#fx-27'), stage = $('#journey'), svg = $('.jr', stage);
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
  let p = 0, pan = 0;
  onPinnedScroll(section, stage, v => { p = v; });
  loopWhileVisible(stage, () => {
    prog.style.strokeDashoffset = len * (1 - p);
    const pt = prog.getPointAtLength(len * p);
    marker.setAttribute('transform', `translate(${pt.x} ${pt.y})`);
    nodes.forEach(n => n.g.classList.toggle('on', p >= n.f - .005));
    // camera: keep the marker in the middle of the panel
    const box = svg.getBoundingClientRect(), k = box.width / 600;
    pan = lerp(pan, clamp(pt.y * k - stage.clientHeight / 2, 0, Math.max(0, box.height - stage.clientHeight)), .12);
    svg.style.transform = `translateY(${-pan}px)`;
  });
})();

/* ========== 28 velocity marquee ========== */
(() => {
  const stage = $('#marquee');
  const lines = $$('.mq-line', stage).map((el, i) => {
    const text = el.textContent;
    el.textContent = '';
    const track = Object.assign(document.createElement('div'), { className: 'mq-track' });
    track.innerHTML = `<span>${text.repeat(3)}</span><span aria-hidden="true">${text.repeat(3)}</span>`;
    el.append(track);
    return { track, dir: +el.dataset.dir, x: -i * 260 }; // stagger so matching lines don't line up
  });
  let lastY = scrollY, vel = 0, flow = 1;
  loopWhileVisible(stage, () => {
    const dy = scrollY - lastY; lastY = scrollY;
    vel = lerp(vel, dy, .15);
    if (Math.abs(dy) > .5) flow = Math.sign(dy); // keep drifting the way you last scrolled
    const skew = clamp(-vel * .35, -16, 16), blur = Math.min(Math.abs(vel) * .04, 2.5);
    lines.forEach(l => {
      const half = l.track.firstChild.offsetWidth;
      l.x -= l.dir * (1.2 * flow + vel * .6);
      if (l.x <= -half) l.x += half;
      if (l.x > 0) l.x -= half;
      l.track.style.transform = `translateX(${l.x}px) skewX(${skew * l.dir}deg)`;
      l.track.style.filter = blur > .2 ? `blur(${blur}px)` : '';
    });
  });
})();

/* ========== 29 page wipe + text decode ========== */
(() => {
  const stage = $('#wipe'), page = $('.wb-page', stage), url = $('.wb-url', stage), c1 = $('.c1', stage), c2 = $('.c2', stage);
  const PAGES = {
    home: () => `<div class="wp-eyebrow st" style="--d:0">Dental clinic · open Sat–Thu</div>
      <h3 class="wp-title" data-scramble>Your smile, on autopilot.</h3>
      <p class="wp-text st" style="--d:2">Ask anything, book in seconds, get reminded. The clinic's assistant is awake when the reception desk isn't.</p>
      <button class="wp-cta st" style="--d:3" data-go="book">Book a visit →</button>`,
    services: () => `<div class="wp-eyebrow st" style="--d:0">8 treatments</div>
      <h3 class="wp-title" data-scramble>Services and prices</h3>
      <div class="wp-grid">${SERVICES.slice(0, 4).map((s, i) => `<div class="wp-tile st" style="--d:${i + 2}"><b>${s.name}</b><span>${s.min} min · ${egp(s.price)}</span></div>`).join('')}</div>`,
    book: () => `<div class="wp-eyebrow st" style="--d:0">Dr. Sarah Mansour</div>
      <h3 class="wp-title" data-scramble>Pick a time</h3>
      <p class="wp-day st" style="--d:1">Thursday</p>
      <div class="wp-slots">${['2:00 PM', '2:30 PM', '4:30 PM', '5:15 PM', '5:45 PM', '6:30 PM'].map((t, i) => `<button class="st" style="--d:${i + 2}">${t}</button>`).join('')}</div>`,
  };
  const GLYPHS = '!-_/[]{}=+*^?#0123456789';
  let scrambleRun = 0;
  // Each letter flickers through random symbols, then settles, left to right.
  function scramble(el) {
    const id = ++scrambleRun, text = (el.dataset.text ??= el.textContent);
    const plan = [...text].map((ch, i) => ({ ch, end: 8 + i * 1.4 + Math.random() * 14 }));
    let frame = 0;
    (function tick() {
      if (id !== scrambleRun) return;
      let html = '', done = 0;
      for (const q of plan) {
        if (frame >= q.end || q.ch === ' ') { html += q.ch; done++; }
        else html += `<span class="scr">${GLYPHS[(Math.random() * GLYPHS.length) | 0]}</span>`;
      }
      el.innerHTML = html;
      frame++;
      if (done < plan.length) requestAnimationFrame(tick);
    })();
  }
  let current = 'home', busy = false;
  function render(name) {
    page.innerHTML = PAGES[name]();
    url.textContent = `brightsmile / ${name}`;
    $$('.wb-nav button', stage).forEach(b => b.classList.toggle('on', b.dataset.page === name));
    scramble($('[data-scramble]', page));
    const slots = $$('.wp-slots button', page);
    slots.forEach(b => b.addEventListener('click', () => slots.forEach(x => x.classList.toggle('pick', x === b))));
    $('[data-go]', page)?.addEventListener('click', e => go(e.currentTarget.dataset.go));
  }
  const sweep = (el, from, to, delay) => el.animate(
    [{ transform: `translateY(${from})` }, { transform: `translateY(${to})` }],
    { duration: 460, delay, easing: 'cubic-bezier(.7,0,.25,1)', fill: 'forwards' },
  ).finished;
  async function go(name) {
    if (busy || name === current) return;
    busy = true; current = name;
    await Promise.all([sweep(c1, '100%', '0%', 0), sweep(c2, '100%', '0%', 90)]);   // cover
    render(name);                                                                   // swap while hidden
    await Promise.all([sweep(c2, '0%', '-100%', 60), sweep(c1, '0%', '-100%', 150)]); // reveal
    busy = false;
  }
  $$('.wb-nav button', stage).forEach(b => b.addEventListener('click', () => go(b.dataset.page)));
  render('home');
  whenVisible(stage, () => { const t = $('[data-scramble]', page); if (t) scramble(t); });
})();

/* ========== 30 gooey contact menu ========== */
(() => {
  const stage = $('#goo'), btn = $('.goo-icons .main', stage), caption = $('.goo-caption', stage);
  const blobs = $$('.goo-blobs .opt', stage), icons = $$('.goo-icons .opt', stage);
  const ANGLES = [-160, -120, -60, -20];
  const SAY = ['Calling BrightSmile…', 'Opening WhatsApp…', 'Opening the booking chat…', 'Opening the map…'];
  const place = open => {
    const R = stage.clientWidth < 520 ? 104 : 136;
    [blobs, icons].forEach(list => list.forEach((el, i) => {
      const a = ANGLES[i] * Math.PI / 180;
      el.style.setProperty('--k', open ? i : ANGLES.length - 1 - i);
      el.style.transform = open ? `translate(${Math.cos(a) * R}px, ${Math.sin(a) * R}px)` : '';
    }));
  };
  btn.addEventListener('click', () => {
    const open = !stage.classList.contains('open');
    stage.classList.toggle('open', open); btn.setAttribute('aria-expanded', open);
    place(open);
  });
  let timer;
  icons.forEach((ic, i) => {
    ic.addEventListener('pointerenter', () => { blobs[i].style.scale = '1.18'; });
    ic.addEventListener('pointerleave', () => { blobs[i].style.scale = ''; });
    ic.addEventListener('click', e => {
      e.preventDefault();
      caption.textContent = SAY[i];
      clearTimeout(timer); timer = setTimeout(() => { caption.textContent = "Need us? We're one tap away."; }, 1800);
    });
  });
  addEventListener('resize', () => place(stage.classList.contains('open')));
})();

measurePins();
