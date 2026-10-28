# Portfolio Website — Handoff Brief

Context carried over from a Claude chat (Oct 27, 2026). Read this before any design or UI work on the portfolio.

Full study doc (14 videos analyzed, 30 effects cataloged): https://claude.ai/artifact/PRsremQ7T2gGNE3jKCXeRj
If `docs/portfolio-study.md` exists in this repo, it is the Markdown export of that doc.

## Owner and positioning
- Zeiad, AI engineer. Positioning: **Agentic AI, chatbots, MCP, automation, smart systems** (not computer vision).
- Goal: a portfolio that feels "not from this earth" — cinematic scroll, real-time 3D, cursor-level polish — while staying fast on phones.

## Concept: "Mission Control"
The visitor boots up an AI agent, and the agent is Zeiad.
- Palette: near-black space, ONE electric accent (cyan or acid lime), white type.
- Fonts: one mono font for "system" text, one bold display font for the name.

## Page structure
| # | Section | Behavior | Effects |
|---|---|---|---|
| 0 | Boot loader | Terminal types "initializing agent: Zeiad" + 0–100 counter | Typewriter, counter; hides asset loading |
| 1 | Hero | Rim-lit portrait assembles from floating circuit parts as you scroll; 3 text beats: Agentic AI / Automation / MCP | Canvas image-sequence scrub, pinned section (300–500vh), giant name type |
| 2 | About | Short human paragraph, handwritten note + arrow to a real photo | Masked letter reveal, SVG stroke scribbles, light depth parallax |
| 3 | Capabilities | Particle cloud morphs per skill: neural net → chat bubble → network graph → gears | Three.js Points, lerp between target shapes on scroll |
| 4 | Selected work | Project list; hover shows cursor-following preview; click wipes into case study | Cursor-follow image, glitch hover, page wipe |
| 5 | Live agent | "Ask my agent about me" chat answering from CV + projects | Real LLM demo, typing animation |
| 6 | Process | Brief → Build → Deploy → Automate | Horizontal scroll section |
| 7 | Contact | Glowing magnetic "Launch a project" button, giant footer name, loop back to hero | Magnetic button, seamless loop |

Section 4 order: agentic AI and chatbot builds first, automation workflows next, TM Energy as full-stack proof.

## Stack
- Vite + vanilla JS or React (no no-code builders)
- Lenis (smooth scroll), GSAP + ScrollTrigger (pinning, beats, scrubbing)
- Canvas 2D for the hero sequence; Three.js for particles (lazy-loaded)
- One scroll-progress value (0→1) drives frames, camera, shaders and text everywhere.

## Hero asset recipe
1. Clean portrait → image model relights it: cyan rim light on black, 16:9.
2. Second still: same framing, bust broken into floating circuit/metal parts.
3. Video model: animate parts → assembled, 10–12 s, static camera, no text.
4. ffmpeg → 150–180 frames; WebP at 1600px wide + a 900px set for phones.
5. Build from a written prompt guide (stack, sections, scroll lengths, beats, perf rules), not a one-liner.

## Build phases (do not advance until the gate passes)
1. Concept — moodboard, copy, AI hero frames, case-study text → gate: frames approved
2. Foundation — Vite, Lenis, GSAP, skeleton, mobile layout → gate: smooth on a phone
3. Hero — canvas sequence, text beats, preload, fallback → gate: 60 fps hero (make-or-break)
4. Signature — particle morph, hovers, wipes, live agent chat (ONE 3D signature only) → gate: feels finished
5. Launch — speed, a11y, deploy, domain → gate: Lighthouse 90+

## Performance and accessibility rules
- Frames as WebP/AVIF; lighter set on phones; preload first 10, stream the rest; show frame 0 instantly
- Draw in requestAnimationFrame, never inside the scroll handler
- Cap devicePixelRatio at 2 (canvas and Three.js); lazy-load Three.js near section 3
- prefers-reduced-motion → still hero + simple fades
- All text is real HTML (never baked into frames)
- Keyboard access + visible focus for every hover-only reveal
- Test on a mid-range Android before closing any phase
- Scroll ends exactly at the footer — no dead space

## Avoid
- Stacking many 3D effects (pick one signature moment)
- Generic prompt-library output as the final design
- Heavy unoptimized assets on mobile

## Reference videos (also in Zeiad's Google Drive folder "Claude Downloads")
- MOST IMPORTANT — scroll-sequence recipe: https://www.youtube.com/watch?v=h8Yj55Ogc3k
- Lando Norris depth-layer breakdown: https://www.facebook.com/share/r/19UaVZwPC8/
- Portfolio with free AI tools (portrait hero): https://youtu.be/tf_yi6DtDOQ
- 5 award portfolios: https://youtu.be/5aoaf5qtClM
- Portfolio inspiration 2026: https://youtu.be/uw6C8Z1XieY
- Scroll-video sites with Claude Code: https://youtu.be/snErQUyqwCU
