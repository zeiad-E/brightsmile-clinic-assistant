# BrightSmile — Web App

The patient-facing website, the assistant chat and the clinic dashboards for BrightSmile Dental Clinic.
Built with **Next.js 16** (App Router, Cache Components), **React 19** and **Tailwind CSS 4**, in English and Arabic (right-to-left).

## Run it

```bash
npm install
cp .env.example .env.local   # point NEXT_PUBLIC_API_URL at the backend
npm run dev                  # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build (prerenders both languages) |
| `npm run start` | Serves the production build |
| `npm run lint` | ESLint |

## Structure

```
proxy.js                 Sends /… to /en/… or /ar/… (cookie → browser language → English)
app/
  globals.css            Design tokens (colours, fonts, motion) as a Tailwind theme
  [lang]/layout.js       Root layout: <html lang dir>, fonts, session provider
  [lang]/(site)/         Public website: header + footer layout, pages, 404
components/
  site/                  Header, navigation, language switch, footer
  ui/                    Shared building blocks (buttons, …)
  providers/             SessionProvider (sign-in state, token refresh)
i18n/                    Languages config + en/ar dictionaries
lib/api/                 API client, cached public data, chat stream (SSE)
lib/auth/                Session storage
```

## Conventions

- **Server components by default.** Only interactive pieces use `'use client'`.
- **Every visible string lives in `i18n/en.json` and `i18n/ar.json`.**
- **Logical CSS only** (`ms-*`, `ps-*`, `start-*`, `text-start`), so layouts flip automatically in Arabic.
- Public data is cached with `'use cache'` + `cacheLife`; signed-in data is fetched in the browser with the user's token.
