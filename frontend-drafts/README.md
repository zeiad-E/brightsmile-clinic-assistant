# Frontend drafts

A scratch space for trying out looks, layouts, and animations before the real frontend gets built.

Everything here is plain **HTML + CSS + vanilla JS**: no frameworks and no build step. Open a file in a browser and it runs.

> Nothing in this folder ships. The real app lives in [`../frontend`](../frontend). When an idea here works, we rebuild it there properly.

## Layout

```
frontend-drafts/
├── assets/          shared images, icons, fonts, sample data
└── NN-short-name/   one folder per trial (e.g. 01-chat-bubble, 02-hero-gradient)
    ├── index.html
    ├── style.css    (optional)
    └── script.js    (optional)
```

## Conventions

- **One idea per folder.** Number them so they stay in order: `01-`, `02-`, …
- **Self-contained.** Each trial works on its own; only `assets/` is shared.
- **Notes at the top.** Open each `index.html` with a short HTML comment saying what it tries and how it turned out (keep / drop / maybe).
- **Throwaway is fine.** Quick and messy is the point here.

## Running

Open any `index.html` directly, or serve the folder:

```bash
npx serve frontend-drafts
# or
python3 -m http.server -d frontend-drafts 8080
```
