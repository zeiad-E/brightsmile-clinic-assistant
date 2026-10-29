'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MOUSE, TOOTH_READY, clamp, easeInOut, easeOut, journeyMarker, lerp, pinTopScreen, pinY, prefersReducedMotion, toothState } from '@/lib/motion';
import { Mascot } from '../icons';
import { MODEL_CY, MODEL_H, STRIDE, getMesh } from './toothMesh';

/**
 * The travelling 3D tooth (raw WebGL, no library), ported from trial 003. Its shape is the Blender
 * molar in /models/molar.glb (see toothMesh.js).
 * One full-screen canvas sits above the page; invisible "spots" in each section (<div data-spot="…">)
 * tell it where to stand. As you scroll, it glides from spot to spot and turns to a new angle.
 *
 * Loaded only on the home page, and only in the browser (see HomeEffects: next/dynamic, ssr: false).
 */

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
    float e = k * k * k * (k * (k * 6. - 15.) + 10.);  // "smootherstep": starts and lands with zero speed
    float r = 1. - e;
    vec3 away = normalize(vec3(a_cen.x, a_cen.y * .3, a_cen.z) + vec3(1e-4));
    vec3 c = rotY(a_cen + away * a_fly.y * r + vec3(0., a_fly.z * r, 0.), (a_fly.x + u_t * 1.1) * r);
    vec3 ax = normalize(a_axis + vec3(1e-5));
    float ang = length(a_axis) * r;
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
    vec3 n = normalize(v_n);
    vec3 V = vec3(0., 0., 1.);
    vec3 L = normalize(vec3(-.5, .75, .55)), L2 = normalize(vec3(.75, -.15, .45));
    float wrap = pow(max(dot(n, L) * .5 + .5, 0.), 1.7);          // soft, wrapped light: enamel scatters light
    float fill = max(dot(n, L2), 0.);
    float nh = max(dot(n, normalize(L + V)), 0.);
    float coat = pow(nh, 44.) * .4, sheen = pow(nh, 10.) * .1;    // soft glossy highlight + broad gloss (kept low so the cusps don't wash out to flat white)
    float fres = pow(1. - max(dot(n, V), 0.), 3.);
    float ao = mix(.66, 1., smoothstep(.15, .85, v_ao));           // grooves and the gaps between roots go a little darker
    vec3 col = mix(vec3(.56, .72, .75), vec3(.93, .925, .905), wrap) * ao + fill * vec3(.1, .2, .19);
    col *= mix(.86, 1., smoothstep(-1.8, .35, v_y));               // roots a touch deeper than the crown
    vec3 R = reflect(-V, n);
    col += vec3(.7, .95, .9) * smoothstep(.1, 1., R.y) * .1;
    col += vec3(.36, .9, .82) * fres * .4 + coat + sheen;
    vec3 mint = vec3(.37, .92, .83), teal = vec3(.06, .58, .54);
    vec3 flying = mix(teal, mint, smoothstep(.2, .8, v_k)) * (.75 + .25 * wrap) + (coat + sheen) * .6;
    col = mix(flying, col, smoothstep(.55, .98, v_k));            // pieces fly in teal, warm to mint, land as enamel
    col += mint * exp(-pow((v_raw - 1.) * 5., 2.)) * .35;         // a soft flash as each piece lands
    float a = u_alpha * v_appear * (.45 + .55 * smoothstep(0., .35, v_k));
    gl_FragColor = vec4(min(col, 1.) * a, a);
  }`;

const DURATION = 4900; // the whole assembly, in ms

// rotation: yaw (Y), then pitch (X); column-major for WebGL
function rotMat(rx, ry) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
  return new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
}

export default function ToothCompanion() {
  const canvasRef = useRef(null);
  const [fallbackSpot, setFallbackSpot] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const gl = canvas.getContext('webgl', { antialias: true, alpha: true, premultipliedAlpha: true });
    if (!gl) {
      // No WebGL (very old device or disabled): show the flat mascot in the hero instead.
      setFallbackSpot(document.querySelector('[data-spot="hero"]'));
      return;
    }

    /* ---------- shaders and buffer ---------- */
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    [['a_pos', 3, 0], ['a_nrm', 3, 3], ['a_cen', 3, 6], ['a_fly', 4, 9], ['a_axis', 3, 13], ['a_ao', 1, 16]].forEach(([name, size, off]) => {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
    });
    const U = {};
    ['u_t', 'u_px', 'u_persp', 'u_cy', 'u_rot', 'u_center', 'u_view', 'u_alpha'].forEach((n) => {
      U[n] = gl.getUniformLocation(prog, n);
    });
    gl.uniform1f(U.u_persp, 0.14);
    gl.uniform1f(U.u_cy, MODEL_CY);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Warm-up: browsers (Chrome on Windows above all) prepare shaders on the first draw, which can
    // freeze the page for a moment. Do it now, with an invisible triangle, before the hero text starts.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(3 * STRIDE), gl.STATIC_DRAW);
    gl.uniform1f(U.u_alpha, 0);
    gl.uniform2f(U.u_view, 1, 1);
    gl.uniformMatrix3fv(U.u_rot, false, new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));

    let alive = true;
    let COUNT = 0;
    getMesh().then(
      (mesh) => {
        if (!alive) return;
        gl.bufferData(gl.ARRAY_BUFFER, mesh.data, gl.STATIC_DRAW);
        COUNT = mesh.triCount * 3;
        if (!toothState.ready) {
          // tell the hero text to start once the full mesh has been drawn (two frames from now)
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              toothState.ready = true;
              window.dispatchEvent(new Event(TOOTH_READY));
            }),
          );
        }
      },
      // the model file failed to download: same fallback as no WebGL (the hero text starts on its own timer)
      () => alive && setFallbackSpot(document.querySelector('[data-spot="hero"]')),
    );

    /* ---------- canvas size ---------- */
    let VW = 0, VH = 0;
    const RES = Math.min(window.devicePixelRatio || 1, 1.5); // a full-screen canvas: 1.5× is sharp enough and far lighter than 2×
    const resize = () => {
      VW = window.innerWidth;
      VH = window.innerHeight;
      canvas.width = Math.round(VW * RES);
      canvas.height = Math.round(VH * RES);
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    /* ---------- choreography: measured once (and on resize), then pure maths every frame ---------- */
    const SPOTS = { hero: null, story: 'story', services: 'services', assistant: null, book: null }; // spot → its pinned section
    const geo = {};
    let KEYS = [];
    const byId = (id) => document.getElementById(id);
    function measure() {
      resize();
      for (const [name, pinId] of Object.entries(SPOTS)) {
        const spot = document.querySelector(`[data-spot="${name}"]`);
        if (!spot) return;
        const r = spot.getBoundingClientRect();
        const g = { left: r.left, w: r.width, h: r.height };
        if (pinId) {
          const sec = byId(pinId), pr = sec.querySelector('[data-pin]').getBoundingClientRect(), sr = sec.getBoundingClientRect();
          Object.assign(g, { pinAbs: sr.top + window.scrollY, pinH: sec.offsetHeight, off: r.top - pr.top });
        } else g.abs = r.top + window.scrollY;
        geo[name] = g;
      }
      const absTop = (id) => byId(id).getBoundingClientRect().top + window.scrollY;
      const centreOf = (name) => geo[name].abs + geo[name].h / 2 - window.innerHeight / 2;
      const [story, portal, services, journey, stack] = ['story', 'portal', 'services', 'how', 'stack'].map(byId);
      const TAU = Math.PI * 2;
      KEYS = [
        { y: 0, pose: 'hero', rx: -0.12, ry: -0.35, op: 1 },
        { y: pinY(story, 0.07), pose: 'story', rx: -0.05, ry: -0.3, op: 1 }, // glides from the hero into the story: front
        { y: pinY(story, 0.34), pose: 'story', rx: 0.05, ry: Math.PI / 2, op: 1 }, // side
        { y: pinY(story, 0.62), pose: 'story', rx: 1.0, ry: Math.PI * 0.95, op: 1 }, // from above
        { y: pinY(story, 0.9), pose: 'story', rx: 0.3, ry: Math.PI * 1.7, op: 1 }, // three-quarter back
        { y: pinY(story, 1), pose: 'story', rx: 0.3, ry: Math.PI * 1.8, op: 0 }, // steps out before the portal
        { y: pinY(portal, 1), pose: 'services', rx: 0.15, ry: TAU * 1.6, op: 0 }, // reappears after the portal
        { y: pinY(services, 0.04), pose: 'services', rx: 0.15, ry: TAU * 2, op: 1 },
        { y: pinY(services, 0.96), pose: 'services', rx: 0.15, ry: TAU * 3, op: 1 }, // one full turn while cards pass
        { y: absTop('xray') - window.innerHeight * 0.2, pose: 'services', rx: 0.15, ry: TAU * 3.2, op: 0 },
        { y: pinY(journey, 0), pose: 'marker', rx: 0, ry: TAU * 3, op: 0 },
        { y: pinY(journey, 0.04), pose: 'marker', rx: 0.1, ry: TAU * 3.1, op: 1 },
        { y: pinY(journey, 0.97), pose: 'marker', rx: 0.1, ry: TAU * 5, op: 1 }, // spins as it rides the path
        { y: centreOf('assistant'), pose: 'assistant', rx: 0.1, ry: TAU * 5 - 0.65, op: 1 }, // turns to look at the chat
        { y: pinY(stack, 0), pose: 'assistant', rx: 0.1, ry: TAU * 5 - 0.65, op: 0 },
        { y: centreOf('book'), pose: 'book', rx: -0.1, ry: TAU * 6 + 0.35, op: 1 },
      ];
      const max = document.documentElement.scrollHeight - window.innerHeight;
      KEYS.forEach((k, i) => {
        k.y = Math.min(k.y, max);
        if (i && k.y <= KEYS[i - 1].y) k.y = KEYS[i - 1].y + 1;
      });
    }
    const fit = (w, h) => Math.min(h, w / 0.82);
    function pose(name) {
      if (name === 'marker') return { x: journeyMarker.x, y: journeyMarker.y, size: window.innerWidth < 860 ? 64 : 96 };
      const g = geo[name];
      const top = g.pinAbs !== undefined ? pinTopScreen(g.pinAbs, g.pinH) + g.off : g.abs - window.scrollY;
      return { x: g.left + g.w / 2, y: top + g.h / 2, size: fit(g.w, g.h) };
    }
    measure();
    window.addEventListener('resize', measure);
    document.fonts?.ready.then(() => alive && measure());
    // Images and late fonts can shift the layout after the first measure; measure again shortly after.
    const remeasure = setTimeout(measure, 1200);

    /* ---------- the frame loop ---------- */
    const reduced = prefersReducedMotion();
    let start = 0, mx = 0, my = 0, frameId = 0;
    function frame(now) {
      frameId = requestAnimationFrame(frame);
      if (!COUNT || KEYS.length < 2) return; // still building
      if (!start) start = now + 150; // the clock starts once the mesh is ready, so no part of the flight is skipped
      const t = reduced || toothState.shown ? 2 : Math.max(0, (now - start) / DURATION);
      if (t >= 2) toothState.shown = true; // assembled once; don't replay it when coming back to the page
      const s = window.scrollY;
      let i = 0;
      while (i < KEYS.length - 2 && s >= KEYS[i + 1].y) i++;
      const A = KEYS[i], B = KEYS[i + 1];
      const f = easeInOut(clamp((s - A.y) / (B.y - A.y)));
      const pa = pose(A.pose), pb = A.pose === B.pose ? pa : pose(B.pose);
      let x = lerp(pa.x, pb.x, f), y = lerp(pa.y, pb.y, f);
      const size = lerp(pa.size, pb.size, f);
      let rx = lerp(A.rx, B.rx, f), ry = lerp(A.ry, B.ry, f);
      const op = lerp(A.op, B.op, f);

      // alive: follows the mouse a little, breathes, and turns gently into place while assembling
      mx = lerp(mx, MOUSE.x, 0.05);
      my = lerp(my, MOUSE.y, 0.05);
      const heroW = clamp(1 - s / (window.innerHeight * 0.5));
      const sec = reduced ? 0 : now / 1000;
      x += mx * 26 * heroW;
      y += my * 18 * heroW + Math.sin(sec * 1.2) * size * 0.012;
      rx += my * 0.22 + Math.sin(sec * 0.8) * 0.04;
      ry += mx * 0.35 + Math.sin(sec * 0.5) * 0.1 + (1 - easeOut(clamp(t))) * 1.4;

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (op > 0.01 && size > 4) {
        gl.uniform1f(U.u_t, t);
        gl.uniform1f(U.u_alpha, op);
        gl.uniform1f(U.u_px, size / MODEL_H);
        gl.uniform2f(U.u_center, x, y);
        gl.uniform2f(U.u_view, VW, VH);
        gl.uniformMatrix3fv(U.u_rot, false, rotMat(rx, ry));
        gl.drawArrays(gl.TRIANGLES, 0, COUNT);
      }
    }
    frameId = requestAnimationFrame(frame);

    // Clean-up: runs when you leave the page (or Next.js hides it). Stop drawing and free GPU memory.
    return () => {
      alive = false;
      cancelAnimationFrame(frameId);
      clearTimeout(remeasure);
      window.removeEventListener('resize', measure);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(prog);
    };
  }, []);

  return (
    <>
      {/* the drop shadow follows the tooth's outline, so the white tooth stays clear on white sections */}
      <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-30 h-screen w-screen drop-shadow-[0_16px_22px_rgba(8,52,58,0.24)]" />
      {fallbackSpot && createPortal(<Mascot />, fallbackSpot)}
    </>
  );
}
