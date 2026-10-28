# Trainer

A personal, mobile-first strength tracker. A four-day A/B/C/D rotation, one-tap set logging, and double progression that recommends the next weight from what you actually lifted. Design: `docs/superpowers/specs/2026-10-27-abcd-double-progression-design.md`.

Solo project. Built for one user (me).

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · Supabase (Postgres + Auth + Storage) · Drizzle ORM · Vitest

## First-Time Setup

1. **Create a Supabase project** at https://supabase.com.
2. **Configure Google OAuth** — see `docs/superpowers/plans/2026-04-23-plan-1-foundation-auth.md` § Prerequisites.
3. **Copy env template:**
   ```bash
   cp .env.example .env.local
   ```
   Fill in every value in `.env.local`.
4. **Install deps:**
   ```bash
   npm install
   ```
5. **Apply the DB schema:**
   ```bash
   npm run db:migrate
   ```
6. **Apply RLS policies + triggers:**
   ```bash
   set -a; source .env.local; set +a
   psql "$DATABASE_URL" -f supabase/policies.sql
   ```
   Or paste `supabase/policies.sql` into Supabase Dashboard → SQL Editor and run it.
7. **Start dev server:**
   ```bash
   npm run dev
   ```
   Open http://localhost:3000 and sign in with Google.

## Scripts

- `npm run dev` — start dev server
- `npm run build` / `npm start` — production
- `npm test` — run vitest
- `npm run db:generate` — generate migrations from schema changes
- `npm run db:migrate` — apply pending migrations
- `npm run db:studio` — open Drizzle Studio
- `npm run lint` — eslint

## Deployment

Push to `main` → Vercel auto-deploys. Add the same env vars in Vercel Dashboard → Settings → Environment Variables.

Before the first deploy, add the production URL to Supabase → Authentication → URL Configuration → Site URL (e.g., `https://trainer.vercel.app`). The Google OAuth redirect URI stays the same (`https://<project-ref>.supabase.co/auth/v1/callback`) — only the *app's* site URL needs to change per environment.

## Plans

Implementation plans live in `docs/superpowers/plans/`. Specs live in `docs/superpowers/specs/`.
