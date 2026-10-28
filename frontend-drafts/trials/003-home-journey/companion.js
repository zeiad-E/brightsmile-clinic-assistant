// The travelling 3D tooth. Raw WebGL, no library.
// 1) The shape is a smooth "distance field" (a crown with four soft cusps melting into two roots).
// 2) A mesh is wrapped around that shape, with normals taken from the field, so the lighting is smooth.
// 3) The surface is cut into ~160 curved pieces that spiral in and land to build the tooth.
// 4) Scroll choreography moves it between "spots"; positions are measured once, not every frame.
// Uses helpers from app.js ($, $$, clamp, lerp, easing, MOUSE, REDUCED, DPR, ICONS, pinY, pinTopScreen).

(() => {
  const canvas = $('#companion');
  const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
  if (!gl) { // no WebGL: show the flat mascot in the hero instead
    $('#spotHero').innerHTML = ICONS.mascot();
    canvas.remove();
    return;
  }

  /* ---------- 1. the tooth as a distance field: < 0 inside, > 0 outside ---------- */
  // (Plain Math.sqrt on purpose: Math.hypot is far slower, and these run hundreds of thousands of times.)
  const smin = (a, b, k) => { let h = .5 + .5 * (b - a) / k; h = h < 0 ? 0 : h > 1 ? 1 : h; return b + (a - b) * h - k * h * (1 - h); }; // smooth union
  const smax = (a, b, k) => -smin(-a, -b, k); // smooth subtraction helper
  const ellipsoid = (x, y, z, rx, ry, rz) => {
    const ax = x / rx, ay = y / ry, az = z / rz, bx = ax / rx, by = ay / ry, bz = az / rz;
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az), k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    return k0 * (k0 - 1) / (k1 || 1e-6);
  };
  const sphere = (x, y, z, r) => Math.sqrt(x * x + y * y + z * z) - r;
  // a tube from A to B whose radius shrinks from r1 to r2: one root
  const taper = (x, y, z, ax, ay, az, bx, by, bz, r1, r2) => {
    const bax = bx - ax, bay = by - ay, baz = bz - az, pax = x - ax, pay = y - ay, paz = z - az;
    let t = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (r1 + (r2 - r1) * t);
  };
  // the earlier body and roots (smooth, simple), with the newer top: four defined cusps and a "+" shaped fissure
  function field(x, y, z) {
    let d = ellipsoid(x, y - .42, z, 1.0, .64, .86);                                        // crown body
    const cy = y - .9;
    d = smin(d, sphere(x + .4, cy, z + .33, .36), .2);                                       // four cusps
    d = smin(d, sphere(x - .42, cy, z + .31, .34), .2);
    d = smin(d, sphere(x + .38, cy, z - .35, .34), .2);
    d = smin(d, sphere(x - .4, cy, z - .34, .36), .2);
    if (y > .9) {                                                                             // the "+" fissure only matters up top
      d = smax(d, -taper(x, y, z, -.75, 1.2, 0, .75, 1.2, 0, .085, .085), .07);
      d = smax(d, -taper(x, y, z, 0, 1.2, -.62, 0, 1.2, .62, .085, .085), .07);
    }
    d = smin(d, ellipsoid(x, y + .04, z, .8, .42, .68), .26);                                // the neck
    if (y < .5) for (let s = -1; s <= 1; s += 2) d = smin(d, taper(x, y, z, s * .36, .05, 0, s * .5, -1.32, 0, .34, .1), .3); // two roots
    return d;
  }
  const MODEL_H = 2.7, MODEL_CY = 0; // overall height (model units) and vertical centre

  // Building the mesh is a lot of maths, so it runs as a generator: a little per frame, never freezing the page.
  const STRIDE = 17; // pos3 nrm3 cen3 fly4 axis3 ao1
  function* buildMesh() {
    /* ---------- 2. wrap a mesh around the field ("surface nets") ---------- */
    const H = innerWidth < 860 ? .05 : .04;               // grid spacing: smaller = smoother, heavier
    const X0 = -1.25, Y0 = -1.55, Z0 = -1.1;
    const NX = Math.ceil(2.5 / H), NY = Math.ceil(2.95 / H), NZ = Math.ceil(2.2 / H);
    const at = (i, j, k) => i + (NX + 1) * (j + (NY + 1) * k);
    const F = new Float32Array((NX + 1) * (NY + 1) * (NZ + 1));
    // A coarse pass first: far from the surface the coarse value is good enough, so the exact (costly) field is
    // only evaluated in a thin band around the tooth.
    const CS = 4, CNX = Math.ceil(NX / CS), CNY = Math.ceil(NY / CS), CNZ = Math.ceil(NZ / CS);
    const cat = (i, j, k) => i + (CNX + 1) * (j + (CNY + 1) * k);
    const C = new Float32Array((CNX + 1) * (CNY + 1) * (CNZ + 1));
    for (let k = 0; k <= CNZ; k++) for (let j = 0; j <= CNY; j++) for (let i = 0; i <= CNX; i++) C[cat(i, j, k)] = field(X0 + i * CS * H, Y0 + j * CS * H, Z0 + k * CS * H);
    const BAND = CS * H * 1.6;
    for (let k = 0; k <= NZ; k++) {
      for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
        const c = C[cat(Math.min(CNX, Math.round(i / CS)), Math.min(CNY, Math.round(j / CS)), Math.min(CNZ, Math.round(k / CS)))];
        F[at(i, j, k)] = Math.abs(c) > BAND ? c : field(X0 + i * H, Y0 + j * H, Z0 + k * H);
      }
      yield;
    }

    const CORNER = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
    const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const cell = (i, j, k) => i + NX * (j + NY * k);
    const cellVert = new Int32Array(NX * NY * NZ).fill(-1);
    const V = []; // vertex positions, flat
    const v8 = new Float32Array(8);
    const OFF = CORNER.map(([x, y, z]) => at(x, y, z)); // corner offsets as plain index steps, computed once
    // one vertex per cell that the surface passes through, at the average of where it crosses the cell's edges
    for (let k = 0; k < NZ; k++) {
      for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
      const base = at(i, j, k);
      let inside = 0;
      for (let c = 0; c < 8; c++) { const f = F[base + OFF[c]]; v8[c] = f; if (f < 0) inside++; }
      if (inside === 0 || inside === 8) continue;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let e = 0; e < 12; e++) {
        const a = EDGES[e][0], b = EDGES[e][1];
        if ((v8[a] < 0) === (v8[b] < 0)) continue;
        const t = v8[a] / (v8[a] - v8[b]);
        sx += CORNER[a][0] + t * (CORNER[b][0] - CORNER[a][0]);
        sy += CORNER[a][1] + t * (CORNER[b][1] - CORNER[a][1]);
        sz += CORNER[a][2] + t * (CORNER[b][2] - CORNER[a][2]);
        n++;
      }
      cellVert[cell(i, j, k)] = V.length / 3;
      V.push(X0 + (i + sx / n) * H, Y0 + (j + sy / n) * H, Z0 + (k + sz / n) * H);
      }
      if (k % 8 === 0) yield;
    }
    // join neighbouring cell vertices into quads wherever a grid edge crosses the surface
    const T = []; // triangles as vertex indices
    const quad = (a, b, c, d) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; T.push(a, b, c, a, c, d); };
    for (let k = 1; k < NZ; k++) for (let j = 1; j < NY; j++) for (let i = 0; i < NX; i++)
      if ((F[at(i, j, k)] < 0) !== (F[at(i + 1, j, k)] < 0)) quad(cellVert[cell(i, j - 1, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i, j - 1, k)]);
    for (let k = 1; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 1; i < NX; i++)
      if ((F[at(i, j, k)] < 0) !== (F[at(i, j + 1, k)] < 0)) quad(cellVert[cell(i - 1, j, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)]);
    for (let k = 0; k < NZ; k++) for (let j = 1; j < NY; j++) for (let i = 1; i < NX; i++)
      if ((F[at(i, j, k)] < 0) !== (F[at(i, j, k + 1)] < 0)) quad(cellVert[cell(i - 1, j - 1, k)], cellVert[cell(i, j - 1, k)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)]);
    // smooth normals: the direction in which the field grows fastest
    const NRM = new Float32Array(V.length), AO = new Float32Array(V.length / 3);
    for (let v = 0; v < V.length; v += 3) {
      const x = V[v], y = V[v + 1], z = V[v + 2], e = .01;
      // gradient from 4 samples at the corners of a tiny tetrahedron (cheaper than 6)
      const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e), c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
      const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      NRM[v] = nx / l; NRM[v + 1] = ny / l; NRM[v + 2] = nz / l;
      // ambient occlusion: step out along the normal; if the shape is still close, this spot is in a crease (fissure, root fork)
      const o1 = field(x + NRM[v] * .08, y + NRM[v + 1] * .08, z + NRM[v + 2] * .08) / .08;
      const o2 = field(x + NRM[v] * .22, y + NRM[v + 1] * .22, z + NRM[v + 2] * .22) / .22;
      AO[v / 3] = (clamp(o1) + clamp(o2)) / 2;
      if (v % 1500 === 0) yield;
    }

    /* ---------- 3. cut the surface into curved pieces, and give each one a flight path ---------- */
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const PIECES = 160;
    const seeds = Array.from({ length: PIECES }, () => (Math.floor(rand() * (V.length / 3))) * 3);
    const triCount = T.length / 3, owner = new Int32Array(triCount);
    const sums = new Float32Array(PIECES * 4);
    for (let t = 0; t < triCount; t++) {
      const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
      const cx = (V[a] + V[b] + V[c]) / 3, cy = (V[a + 1] + V[b + 1] + V[c + 1]) / 3, cz = (V[a + 2] + V[b + 2] + V[c + 2]) / 3;
      let best = 0, bd = 1e9;
      for (let s = 0; s < PIECES; s++) {
        const q = seeds[s], dx = V[q] - cx, dy = V[q + 1] - cy, dz = V[q + 2] - cz, d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = s; }
      }
      owner[t] = best;
      sums[best * 4] += cx; sums[best * 4 + 1] += cy; sums[best * 4 + 2] += cz; sums[best * 4 + 3]++;
      if (t % 3000 === 0) yield;
    }
    const piece = Array.from({ length: PIECES }, (_, s) => {
      const n = sums[s * 4 + 3] || 1, cy = sums[s * 4 + 1] / n;
      const ax = [rand() - .5, rand() - .5, rand() - .5], al = Math.hypot(...ax) || 1, spin = 1.5 + rand() * 3;
      return {
        cen: [sums[s * 4] / n, cy, sums[s * 4 + 2] / n],
        // swirl angle, how far out it starts, how high it starts, when it leaves (roots first, crown last, with some mix)
        fly: [2.4 + rand() * 1.8, .5 + rand() * .9, -.4 + rand() * 1.2, .5 * (.7 * clamp((cy + 1.4) / 2.7) + .3 * rand())],
        axis: ax.map(v => v / al * spin),
      };
    });
    const data = new Float32Array(triCount * 3 * STRIDE);
    for (let t = 0, o = 0; t < triCount; t++) {
      const pc = piece[owner[t]];
      for (let c = 0; c < 3; c++, o += STRIDE) {
        const v = T[t * 3 + c] * 3;
        data[o] = V[v]; data[o + 1] = V[v + 1]; data[o + 2] = V[v + 2];
        data[o + 3] = NRM[v]; data[o + 4] = NRM[v + 1]; data[o + 5] = NRM[v + 2];
        data[o + 6] = pc.cen[0]; data[o + 7] = pc.cen[1]; data[o + 8] = pc.cen[2];
        data[o + 9] = pc.fly[0]; data[o + 10] = pc.fly[1]; data[o + 11] = pc.fly[2]; data[o + 12] = pc.fly[3];
        data[o + 13] = pc.axis[0]; data[o + 14] = pc.axis[1]; data[o + 15] = pc.axis[2];
        data[o + 16] = AO[v / 3];
      }
    }
    return { data, triCount };
  }

  /* ---------- 4. shaders: spiral-in flight, then polished enamel ---------- */
  const VS = `
    attribute vec3 a_pos, a_nrm, a_cen, a_axis;
    attribute vec4 a_fly;
    attribute float a_ao;
    varying float v_ao, v_appear;
    uniform float u_t, u_px, u_persp, u_cy;
    uniform mat3 u_rot;
    uniform vec2 u_center, u_view;
    varying vec3 v_n;
    varying float v_k, v_raw, v_y;
    vec3 turn(vec3 v, vec3 k, float a) { float c = cos(a), s = sin(a); return v * c + cross(k, v) * s + k * dot(k, v) * (1. - c); }
    vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }
    void main() {
      float raw = (u_t - a_fly.w) / .5;                  // 0 → 1 while this piece flies
      float k = clamp(raw, 0., 1.);
      float e = k * k * k * (k * (k * 6. - 15.) + 10.);  // "smootherstep": starts and lands with zero speed, no jolt
      float r = 1. - e;
      vec3 away = normalize(vec3(a_cen.x, a_cen.y * .3, a_cen.z) + vec3(1e-4));
      // spiral in toward its place; while waiting for its turn, a piece slowly orbits with the others (a vortex)
      vec3 c = rotY(a_cen + away * a_fly.y * r + vec3(0., a_fly.z * r, 0.), (a_fly.x + u_t * 1.1) * r);
      vec3 ax = normalize(a_axis + vec3(1e-5));
      float ang = length(a_axis) * r;
      // each piece appears at its own moment (in the same order it will fly), growing from small, so they don't all pop in at once
      float appear = smoothstep(a_fly.w * .6, a_fly.w * .6 + .14, u_t);
      v_appear = appear;
      vec3 p = c + turn(a_pos - a_cen, ax, ang) * mix(.25, 1., appear);
      vec3 n = turn(a_nrm, ax, ang);
      p = u_rot * (p - vec3(0., u_cy, 0.));
      n = u_rot * n;
      float w = 1. / max(.25, 1. - p.z * u_persp);
      vec2 px = u_center + vec2(p.x, -p.y) * u_px * w;
      vec2 clip = px / u_view * 2. - 1.;
      gl_Position = vec4(clip.x, -clip.y, clamp(-p.z * .08, -.99, .99), 1.);
      v_n = n; v_k = k; v_raw = raw; v_y = a_pos.y; v_ao = a_ao;
    }`;
  const FS = `
    precision mediump float;
    varying vec3 v_n;
    varying float v_k, v_raw, v_y, v_ao, v_appear;
    uniform float u_alpha;
    void main() {
      vec3 n = normalize(v_n); // always points outward (it comes from the shape itself), whichever way a triangle is wound
      vec3 V = vec3(0., 0., 1.);
      vec3 L = normalize(vec3(-.5, .75, .55)), L2 = normalize(vec3(.75, -.15, .45));
      float wrap = pow(max(dot(n, L) * .5 + .5, 0.), 1.7);          // soft, wrapped light: enamel scatters light
      float fill = max(dot(n, L2), 0.);
      float nh = max(dot(n, normalize(L + V)), 0.);
      float coat = pow(nh, 90.) * .85, sheen = pow(nh, 16.) * .12;  // polished highlight + soft gloss
      float fres = pow(1. - max(dot(n, V), 0.), 3.);
      float ao = mix(.8, 1., smoothstep(.1, .9, v_ao));               // a light touch of shade in the fissure and cusps
      vec3 col = mix(vec3(.6, .76, .79), vec3(.99, .985, .965), wrap) * ao + fill * vec3(.1, .2, .19);
      col *= mix(.88, 1., smoothstep(-1.3, .1, v_y));                // roots a touch deeper
      vec3 R = reflect(-V, n);
      col += vec3(.7, .95, .9) * smoothstep(.1, 1., R.y) * .1;      // soft reflection of a bright sky
      col += vec3(.36, .9, .82) * fres * .4 + coat + sheen;
      vec3 mint = vec3(.37, .92, .83), teal = vec3(.06, .58, .54);
      vec3 flying = mix(teal, mint, smoothstep(.2, .8, v_k)) * (.75 + .25 * wrap) + (coat + sheen) * .6;
      col = mix(flying, col, smoothstep(.55, .98, v_k));            // pieces fly in teal, warm to mint, land as enamel
      col += mint * exp(-pow((v_raw - 1.) * 5., 2.)) * .35;         // a soft flash as each piece lands
      float a = u_alpha * v_appear * (.45 + .55 * smoothstep(0., .35, v_k)); // fades in on its own cue, solid once it flies
      gl_FragColor = vec4(min(col, 1.) * a, a);
    }`;
  const compile = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  [['a_pos', 3, 0], ['a_nrm', 3, 3], ['a_cen', 3, 6], ['a_fly', 4, 9], ['a_axis', 3, 13], ['a_ao', 1, 16]].forEach(([name, size, off]) => {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
  });
  const U = {};
  ['u_t', 'u_px', 'u_persp', 'u_cy', 'u_rot', 'u_center', 'u_view', 'u_alpha'].forEach(n => { U[n] = gl.getUniformLocation(prog, n); });
  gl.uniform1f(U.u_persp, .14); gl.uniform1f(U.u_cy, MODEL_CY);
  gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  // Warm-up: draw one invisible, zero-size triangle now and wait for it to finish. Browsers (Chrome on Windows above all)
  // prepare shaders on the first draw, which can freeze the page for a moment; better here, before the hero text starts.
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3 * STRIDE), gl.STATIC_DRAW);
  gl.uniform1f(U.u_alpha, 0); gl.uniform2f(U.u_view, 1, 1); gl.uniformMatrix3fv(U.u_rot, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // waits until the GPU really did it

  // run the build ~8 ms per frame; when it finishes, upload the mesh and let the assembly begin
  let COUNT = 0, busy = 0;
  const job = buildMesh();
  (function pump() {
    const t0 = performance.now(), until = t0 + 8;
    while (performance.now() < until) {
      const step = job.next();
      if (step.done) {
        window.toothBuildMs = Math.round(busy + performance.now() - t0); // total maths time, for tuning
        gl.bufferData(gl.ARRAY_BUFFER, step.value.data, gl.STATIC_DRAW);
        COUNT = step.value.triCount * 3;
        // tell the hero text to start once the full mesh has been drawn at least once (two frames from now)
        requestAnimationFrame(() => requestAnimationFrame(() => dispatchEvent(new Event('tooth-ready'))));
        return;
      }
    }
    busy += performance.now() - t0;
    setTimeout(pump, 0);
  })();

  let VW = 0, VH = 0;
  const RES = Math.min(window.devicePixelRatio || 1, 1.5); // a full-screen canvas: 1.5× is sharp enough and far lighter than 2×
  const resize = () => {
    VW = innerWidth; VH = innerHeight;
    canvas.width = Math.round(VW * RES); canvas.height = Math.round(VH * RES);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();

  // rotation: yaw (Y), then pitch (X); column-major for WebGL
  const rotMat = (rx, ry) => {
    const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    return new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
  };

  /* ---------- 5. choreography: measured once, then pure maths every frame ---------- */
  const SPOTS = {
    hero: ['#spotHero', null], story: ['#spotStory', '#story'],
    services: ['#spotServices', '#services'], assistant: ['#spotAssistant', null], book: ['#spotBook', null],
  };
  const geo = {};
  let KEYS = [];
  function measure() {
    resize();
    for (const [name, [sel, pinSel]] of Object.entries(SPOTS)) {
      const r = $(sel).getBoundingClientRect(), g = { left: r.left, w: r.width, h: r.height };
      if (pinSel) {
        const sec = $(pinSel), pr = $('.pin', sec).getBoundingClientRect(), sr = sec.getBoundingClientRect();
        Object.assign(g, { pinAbs: sr.top + scrollY, pinH: sec.offsetHeight, off: r.top - pr.top });
      } else g.abs = r.top + scrollY;
      geo[name] = g;
    }
    const absTop = sel => $(sel).getBoundingClientRect().top + scrollY;
    const centreOf = name => geo[name].abs + geo[name].h / 2 - innerHeight / 2;
    const story = $('#story'), portal = $('#portal'), services = $('#services'), journey = $('#how'), stack = $('#stack');
    const TAU = Math.PI * 2;
    KEYS = [
      { y: 0, pose: 'hero', rx: -.12, ry: -.35, op: 1 },
      { y: pinY(story, .07), pose: 'story', rx: -.05, ry: -.3, op: 1 },                  // glides from the hero straight into the story: front
      { y: pinY(story, .34), pose: 'story', rx: .05, ry: Math.PI / 2, op: 1 },           // side
      { y: pinY(story, .62), pose: 'story', rx: 1.0, ry: Math.PI * .95, op: 1 },         // from above
      { y: pinY(story, .9), pose: 'story', rx: .3, ry: Math.PI * 1.7, op: 1 },           // three-quarter back
      { y: pinY(story, 1), pose: 'story', rx: .3, ry: Math.PI * 1.8, op: 0 },            // steps out before the portal, which stands alone
      { y: pinY(portal, 1), pose: 'services', rx: .15, ry: TAU * 1.6, op: 0 },              // reappears after the portal, in services
      { y: pinY(services, .04), pose: 'services', rx: .15, ry: TAU * 2, op: 1 },
      { y: pinY(services, .96), pose: 'services', rx: .15, ry: TAU * 3, op: 1 },          // one full turn while cards pass
      { y: absTop('#xray-sec') - innerHeight * .2, pose: 'services', rx: .15, ry: TAU * 3.2, op: 0 },
      { y: pinY(journey, 0), pose: 'marker', rx: 0, ry: TAU * 3, op: 0 },
      { y: pinY(journey, .04), pose: 'marker', rx: .1, ry: TAU * 3.1, op: 1 },
      { y: pinY(journey, .97), pose: 'marker', rx: .1, ry: TAU * 5, op: 1 },              // spins as it rides the path
      { y: centreOf('assistant'), pose: 'assistant', rx: .1, ry: TAU * 5 - .65, op: 1 },  // turns to look at the chat
      { y: pinY(stack, 0), pose: 'assistant', rx: .1, ry: TAU * 5 - .65, op: 0 },
      { y: centreOf('book'), pose: 'book', rx: -.1, ry: TAU * 6 + .35, op: 1 },
    ];
    const max = document.documentElement.scrollHeight - innerHeight;
    KEYS.forEach((k, i) => { k.y = Math.min(k.y, max); if (i && k.y <= KEYS[i - 1].y) k.y = KEYS[i - 1].y + 1; });
  }
  // where a spot is on screen right now, from the cached numbers
  const fit = (w, h) => Math.min(h, w / .82);
  function pose(name) {
    if (name === 'marker') { const m = window.journeyMarker || { x: 0, y: 0 }; return { x: m.x, y: m.y, size: innerWidth < 860 ? 64 : 96 }; }
    const g = geo[name];
    const top = g.pinAbs !== undefined ? pinTopScreen(g.pinAbs, g.pinH) + g.off : g.abs - scrollY;
    return { x: g.left + g.w / 2, y: top + g.h / 2, size: fit(g.w, g.h) };
  }
  measure();
  addEventListener('resize', measure);
  document.fonts?.ready.then(measure);
  addEventListener('load', measure);

  /* ---------- 6. the frame loop ---------- */
  const DURATION = 4900;           // the whole assembly, in ms (pieces appear over the first ~1.5 s, all land by ~5 s)
  let start = 0, mx = 0, my = 0;
  function frame(now) {
    if (!COUNT) return requestAnimationFrame(frame); // still building
    if (!start) start = now + 150;  // the clock starts once the mesh is ready, so no part of the flight is skipped
    const t = REDUCED ? 2 : Math.max(0, (now - start) / DURATION);
    const s = scrollY;
    let i = 0;
    while (i < KEYS.length - 2 && s >= KEYS[i + 1].y) i++;
    const A = KEYS[i], B = KEYS[i + 1];
    const f = easeInOut(clamp((s - A.y) / (B.y - A.y)));
    const pa = pose(A.pose), pb = A.pose === B.pose ? pa : pose(B.pose);
    let x = lerp(pa.x, pb.x, f), y = lerp(pa.y, pb.y, f), size = lerp(pa.size, pb.size, f);
    let rx = lerp(A.rx, B.rx, f), ry = lerp(A.ry, B.ry, f);
    const op = lerp(A.op, B.op, f);

    // alive: follows the mouse a little, breathes, and turns gently into place while assembling
    mx = lerp(mx, MOUSE.x, .05); my = lerp(my, MOUSE.y, .05);
    const heroW = clamp(1 - s / (innerHeight * .5));
    const sec = REDUCED ? 0 : now / 1000;
    x += mx * 26 * heroW; y += my * 18 * heroW + Math.sin(sec * 1.2) * size * .012;
    rx += my * .22 + Math.sin(sec * .8) * .04;
    ry += mx * .35 + Math.sin(sec * .5) * .1 + (1 - easeOut(clamp(t))) * 1.4;

    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (op > .01 && size > 4) {
      gl.uniform1f(U.u_t, t); gl.uniform1f(U.u_alpha, op);
      gl.uniform1f(U.u_px, size / MODEL_H);
      gl.uniform2f(U.u_center, x, y); gl.uniform2f(U.u_view, VW, VH);
      gl.uniformMatrix3fv(U.u_rot, false, rotMat(rx, ry));
      gl.drawArrays(gl.TRIANGLES, 0, COUNT);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
