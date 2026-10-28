import { clamp } from '@/lib/motion';

/**
 * The 3D tooth's shape, built from maths in the browser (ported from trial 003, unchanged).
 * 1) The shape is a smooth "distance field": a crown with four soft cusps melting into two roots.
 * 2) A mesh is wrapped around that shape, with normals taken from the field, so lighting is smooth.
 * 3) The surface is cut into ~160 curved pieces that spiral in and land to build the tooth.
 *
 * Building is heavy, so buildMesh() is a generator: it does a little work per call (yield), and the
 * caller spreads the calls over many frames so the page never freezes.
 */

// (Plain Math.sqrt on purpose: Math.hypot is far slower, and these run hundreds of thousands of times.)
const smin = (a, b, k) => {
  let h = 0.5 + (0.5 * (b - a)) / k;
  h = h < 0 ? 0 : h > 1 ? 1 : h;
  return b + (a - b) * h - k * h * (1 - h);
}; // smooth union
const smax = (a, b, k) => -smin(-a, -b, k); // smooth subtraction helper
const ellipsoid = (x, y, z, rx, ry, rz) => {
  const ax = x / rx, ay = y / ry, az = z / rz, bx = ax / rx, by = ay / ry, bz = az / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az), k1 = Math.sqrt(bx * bx + by * by + bz * bz);
  return (k0 * (k0 - 1)) / (k1 || 1e-6);
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

/** < 0 inside the tooth, > 0 outside. */
function field(x, y, z) {
  let d = ellipsoid(x, y - 0.42, z, 1.0, 0.64, 0.86); // crown body
  const cy = y - 0.9;
  d = smin(d, sphere(x + 0.4, cy, z + 0.33, 0.36), 0.2); // four cusps
  d = smin(d, sphere(x - 0.42, cy, z + 0.31, 0.34), 0.2);
  d = smin(d, sphere(x + 0.38, cy, z - 0.35, 0.34), 0.2);
  d = smin(d, sphere(x - 0.4, cy, z - 0.34, 0.36), 0.2);
  if (y > 0.9) {
    // the "+" fissure only matters up top
    d = smax(d, -taper(x, y, z, -0.75, 1.2, 0, 0.75, 1.2, 0, 0.085, 0.085), 0.07);
    d = smax(d, -taper(x, y, z, 0, 1.2, -0.62, 0, 1.2, 0.62, 0.085, 0.085), 0.07);
  }
  d = smin(d, ellipsoid(x, y + 0.04, z, 0.8, 0.42, 0.68), 0.26); // the neck
  if (y < 0.5) for (let s = -1; s <= 1; s += 2) d = smin(d, taper(x, y, z, s * 0.36, 0.05, 0, s * 0.5, -1.32, 0, 0.34, 0.1), 0.3); // two roots
  return d;
}

export const MODEL_H = 2.7; // overall height in model units
export const MODEL_CY = 0; // vertical centre
export const STRIDE = 17; // floats per vertex: pos3 nrm3 cen3 fly4 axis3 ao1

export function* buildMesh(small) {
  /* ---------- wrap a mesh around the field ("surface nets") ---------- */
  const H = small ? 0.05 : 0.04; // grid spacing: smaller = smoother, heavier
  const X0 = -1.25, Y0 = -1.55, Z0 = -1.1;
  const NX = Math.ceil(2.5 / H), NY = Math.ceil(2.95 / H), NZ = Math.ceil(2.2 / H);
  const at = (i, j, k) => i + (NX + 1) * (j + (NY + 1) * k);
  const F = new Float32Array((NX + 1) * (NY + 1) * (NZ + 1));
  // A coarse pass first: far from the surface the coarse value is good enough, so the exact (costly)
  // field is only evaluated in a thin band around the tooth.
  const CS = 4, CNX = Math.ceil(NX / CS), CNY = Math.ceil(NY / CS), CNZ = Math.ceil(NZ / CS);
  const cat = (i, j, k) => i + (CNX + 1) * (j + (CNY + 1) * k);
  const C = new Float32Array((CNX + 1) * (CNY + 1) * (CNZ + 1));
  for (let k = 0; k <= CNZ; k++) for (let j = 0; j <= CNY; j++) for (let i = 0; i <= CNX; i++) C[cat(i, j, k)] = field(X0 + i * CS * H, Y0 + j * CS * H, Z0 + k * CS * H);
  const BAND = CS * H * 1.6;
  for (let k = 0; k <= NZ; k++) {
    for (let j = 0; j <= NY; j++)
      for (let i = 0; i <= NX; i++) {
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
  const OFF = CORNER.map(([x, y, z]) => at(x, y, z)); // corner offsets as plain index steps
  // one vertex per cell that the surface passes through, at the average of where it crosses the cell's edges
  for (let k = 0; k < NZ; k++) {
    for (let j = 0; j < NY; j++)
      for (let i = 0; i < NX; i++) {
        const base = at(i, j, k);
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const f = F[base + OFF[c]];
          v8[c] = f;
          if (f < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGES[e][0], b = EDGES[e][1];
          if (v8[a] < 0 === v8[b] < 0) continue;
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
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    T.push(a, b, c, a, c, d);
  };
  for (let k = 1; k < NZ; k++) for (let j = 1; j < NY; j++) for (let i = 0; i < NX; i++)
    if (F[at(i, j, k)] < 0 !== F[at(i + 1, j, k)] < 0) quad(cellVert[cell(i, j - 1, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i, j - 1, k)]);
  for (let k = 1; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 1; i < NX; i++)
    if (F[at(i, j, k)] < 0 !== F[at(i, j + 1, k)] < 0) quad(cellVert[cell(i - 1, j, k - 1)], cellVert[cell(i, j, k - 1)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)]);
  for (let k = 0; k < NZ; k++) for (let j = 1; j < NY; j++) for (let i = 1; i < NX; i++)
    if (F[at(i, j, k)] < 0 !== F[at(i, j, k + 1)] < 0) quad(cellVert[cell(i - 1, j - 1, k)], cellVert[cell(i, j - 1, k)], cellVert[cell(i, j, k)], cellVert[cell(i - 1, j, k)]);
  // smooth normals: the direction in which the field grows fastest
  const NRM = new Float32Array(V.length), AO = new Float32Array(V.length / 3);
  for (let v = 0; v < V.length; v += 3) {
    const x = V[v], y = V[v + 1], z = V[v + 2], e = 0.01;
    // gradient from 4 samples at the corners of a tiny tetrahedron (cheaper than 6)
    const a = field(x + e, y - e, z - e), b = field(x - e, y - e, z + e), c = field(x - e, y + e, z - e), d = field(x + e, y + e, z + e);
    const nx = a - b - c + d, ny = -a - b + c + d, nz = -a + b - c + d;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    NRM[v] = nx / l;
    NRM[v + 1] = ny / l;
    NRM[v + 2] = nz / l;
    // ambient occlusion: step out along the normal; if the shape is still close, this spot is in a crease
    const o1 = field(x + NRM[v] * 0.08, y + NRM[v + 1] * 0.08, z + NRM[v + 2] * 0.08) / 0.08;
    const o2 = field(x + NRM[v] * 0.22, y + NRM[v + 1] * 0.22, z + NRM[v + 2] * 0.22) / 0.22;
    AO[v / 3] = (clamp(o1) + clamp(o2)) / 2;
    if (v % 1500 === 0) yield;
  }

  /* ---------- cut the surface into curved pieces, and give each one a flight path ---------- */
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const PIECES = 160;
  const seeds = Array.from({ length: PIECES }, () => Math.floor(rand() * (V.length / 3)) * 3);
  const triCount = T.length / 3, owner = new Int32Array(triCount);
  const sums = new Float32Array(PIECES * 4);
  for (let t = 0; t < triCount; t++) {
    const a = T[t * 3] * 3, b = T[t * 3 + 1] * 3, c = T[t * 3 + 2] * 3;
    const cx = (V[a] + V[b] + V[c]) / 3, cy = (V[a + 1] + V[b + 1] + V[c + 1]) / 3, cz = (V[a + 2] + V[b + 2] + V[c + 2]) / 3;
    let best = 0, bd = 1e9;
    for (let s = 0; s < PIECES; s++) {
      const q = seeds[s], dx = V[q] - cx, dy = V[q + 1] - cy, dz = V[q + 2] - cz, d = dx * dx + dy * dy + dz * dz;
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    owner[t] = best;
    sums[best * 4] += cx;
    sums[best * 4 + 1] += cy;
    sums[best * 4 + 2] += cz;
    sums[best * 4 + 3]++;
    if (t % 3000 === 0) yield;
  }
  const piece = Array.from({ length: PIECES }, (_, s) => {
    const n = sums[s * 4 + 3] || 1, cy = sums[s * 4 + 1] / n;
    const ax = [rand() - 0.5, rand() - 0.5, rand() - 0.5], al = Math.hypot(...ax) || 1, spin = 1.5 + rand() * 3;
    return {
      cen: [sums[s * 4] / n, cy, sums[s * 4 + 2] / n],
      // swirl angle, how far out it starts, how high it starts, when it leaves (roots first, crown last, with some mix)
      fly: [2.4 + rand() * 1.8, 0.5 + rand() * 0.9, -0.4 + rand() * 1.2, 0.5 * (0.7 * clamp((cy + 1.4) / 2.7) + 0.3 * rand())],
      axis: ax.map((v) => (v / al) * spin),
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

/**
 * Builds the mesh once per visit, ~8 ms per frame so the page stays smooth. If the home page is
 * hidden and shown again, the finished mesh is reused instead of rebuilt.
 */
let cached = null;
let building = null;
export function getMesh() {
  if (cached) return Promise.resolve(cached);
  building ??= new Promise((resolve) => {
    const job = buildMesh(window.innerWidth < 860);
    const started = performance.now();
    let busy = 0;
    (function pump() {
      const t0 = performance.now(), until = t0 + 8;
      while (performance.now() < until) {
        const step = job.next();
        if (step.done) {
          // For tuning (as in the trial): pure maths time vs. total wall time including waits between frames.
          window.toothBuild = { mathMs: Math.round(busy + performance.now() - t0), totalMs: Math.round(performance.now() - started) };
          cached = step.value;
          resolve(cached);
          return;
        }
      }
      busy += performance.now() - t0;
      setTimeout(pump, 0);
    })();
  });
  return building;
}
