import { clamp } from '@/lib/motion';

/**
 * The 3D tooth's shape: a molar modelled in Blender (assets-src/tooth/build_molar.py → /models/molar.glb).
 * 1) The GLB file is read by hand: it is just a small JSON header plus one block of numbers, so no 3D
 *    library is needed. It holds positions, smooth normals and baked shading (how hidden each point is).
 * 2) The surface is cut into ~160 curved pieces that spiral in and land to build the tooth.
 *
 * Cutting takes a moment, so buildMesh() is a generator: it does a little work per call (yield), and the
 * caller spreads the calls over many frames so the page never freezes.
 */

const MODEL_URL = '/models/molar.glb';
export const MODEL_H = 3.35; // the model is scaled to this height (model units)...
export const MODEL_CY = 0; // ...and centred on y = 0
export const STRIDE = 17; // floats per vertex: pos3 nrm3 cen3 fly4 axis3 ao1

/** The mesh inside a GLB (glTF binary) file: positions, normals, shading, triangle indices. */
function readGlb(buf) {
  const jsonLen = new DataView(buf).getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  const bin = 20 + jsonLen + 8; // the binary block starts after the JSON chunk and its own 8-byte header
  const read = (i) => {
    const acc = gltf.accessors[i], view = gltf.bufferViews[acc.bufferView];
    const Type = { 5126: Float32Array, 5123: Uint16Array, 5125: Uint32Array }[acc.componentType];
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[acc.type];
    return { data: new Type(buf, bin + (view.byteOffset || 0) + (acc.byteOffset || 0), acc.count * size), acc };
  };
  const { attributes, indices } = gltf.meshes[0].primitives[0];
  return { pos: read(attributes.POSITION), nrm: read(attributes.NORMAL).data, col: read(attributes.COLOR_0).data, idx: read(indices).data };
}

export function* buildMesh(buf) {
  const { pos, nrm: NRM, col, idx: T } = readGlb(buf);
  // scale to MODEL_H and centre vertically, so the page can size the tooth without knowing the file
  const { min, max } = pos.acc;
  const k = MODEL_H / (max[1] - min[1]), mid = (max[1] + min[1]) / 2;
  const V = new Float32Array(pos.data.length);
  for (let v = 0; v < V.length; v += 3) {
    V[v] = pos.data[v] * k;
    V[v + 1] = (pos.data[v + 1] - mid) * k;
    V[v + 2] = pos.data[v + 2] * k;
  }
  yield;

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
      fly: [2.4 + rand() * 1.8, 0.5 + rand() * 0.9, -0.4 + rand() * 1.2, 0.5 * (0.7 * clamp(cy / MODEL_H + 0.5) + 0.3 * rand())],
      axis: ax.map((v) => (v / al) * spin),
    };
  });
  const data = new Float32Array(triCount * 3 * STRIDE);
  for (let t = 0, o = 0; t < triCount; t++) {
    const pc = piece[owner[t]];
    for (let c = 0; c < 3; c++, o += STRIDE) {
      const i = T[t * 3 + c], v = i * 3;
      data[o] = V[v]; data[o + 1] = V[v + 1]; data[o + 2] = V[v + 2];
      data[o + 3] = NRM[v]; data[o + 4] = NRM[v + 1]; data[o + 5] = NRM[v + 2];
      data[o + 6] = pc.cen[0]; data[o + 7] = pc.cen[1]; data[o + 8] = pc.cen[2];
      data[o + 9] = pc.fly[0]; data[o + 10] = pc.fly[1]; data[o + 11] = pc.fly[2]; data[o + 12] = pc.fly[3];
      data[o + 13] = pc.axis[0]; data[o + 14] = pc.axis[1]; data[o + 15] = pc.axis[2];
      data[o + 16] = col[i * 4] / 65535; // baked shading, stored as 0..65535 in the file
    }
  }
  return { data, triCount };
}

/**
 * Downloads and prepares the mesh once per visit, ~8 ms per frame so the page stays smooth. If the home
 * page is hidden and shown again, the finished mesh is reused instead of rebuilt.
 */
let cached = null;
let building = null;
export function getMesh() {
  if (cached) return Promise.resolve(cached);
  building ??= fetch(MODEL_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`${MODEL_URL}: ${r.status}`);
      return r.arrayBuffer();
    })
    .then(
      (buf) =>
        new Promise((resolve) => {
          const job = buildMesh(buf);
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
        }),
    )
    .catch((err) => {
      building = null; // try again on the next visit
      throw err;
    });
  return building;
}
