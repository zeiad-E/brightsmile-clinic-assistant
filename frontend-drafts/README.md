# Frontend Drafts

A playground for trying out looks, layouts, ideas and animations **before** we build the real frontend.

The real app lives in [`../frontend`](../frontend) (Next.js). Nothing in this folder is used by it — think of this folder as a sketchbook, and `frontend/` as the finished painting.

## Rules

- **No frameworks, no build step.** Plain HTML, CSS and JavaScript only. Open a file and it works.
- **One idea per trial.** Each trial is its own folder, so trying something new never breaks an older one.
- **Throwaway is fine.** A trial that didn't work out is still useful — it tells us what *not* to do.

## Layout

```
frontend-drafts/
├── index.html        ← gallery: links to every trial
├── _template/        ← copy this to start a new trial
└── trials/
    └── 001-some-idea/
        └── index.html
```

## Starting a new trial

1. Copy `_template/` into `trials/` and rename it with the next number and a short name, e.g. `trials/002-dark-chat/`.
2. Build the idea inside that folder.
3. Add a line for it in `index.html` so it shows up in the gallery.

## Viewing

Either double-click any `index.html`, or serve the whole folder (needed if a trial uses `fetch` or JS modules):

```bash
python -m http.server 5500 --directory frontend-drafts
```

Then open http://localhost:5500.
