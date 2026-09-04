# money-leak-project

A bilingual (Thai/English) personal finance tracker: a Next.js web dashboard plus a LINE Messaging API bot. Send "กินข้าว 120" to LINE — or add it on the web — and it becomes a structured transaction, categorized, summarized, and charted.

## Stack

- **Next.js 16** (App Router, Turbopack) + React 19 + Tailwind CSS v4
- **Supabase** — Postgres with row-level security, Google OAuth, service-role RPCs
- **LINE Messaging API** — signature-verified webhook, durable job queue
- **Gemini API** — fallback parser behind a local rule-based parser
- **Vercel** — git-linked production deploys; **Supabase pg_cron** — every-minute worker sweep
- **Vitest** — 83 unit tests; **GitHub Actions** — lint / typecheck / test / build on every push

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Secrets live only in `.env.local` (gitignored) and in Vercel project settings — never in the repo.

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Supabase publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | server only | bypasses RLS; used by the webhook worker |
| `GEMINI_API_KEY` | server only | AI fallback parser |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | server only | primary / fallback Gemini models |
| `LINE_CHANNEL_SECRET` | server only | webhook signature verification |
| `LINE_CHANNEL_ACCESS_TOKEN` | server only | reply/push messages |

## Local development

```bash
pnpm install
cp .env.example .env.local   # then fill in values
pnpm dev                     # http://localhost:3000
pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build
```

A signed-webhook + worker acceptance script lives at `scripts/e2e-line-queue.mjs` (`node scripts/e2e-line-queue.mjs` against a running dev server).

## Database migrations

Migrations are plain SQL in `supabase/migrations/`, applied in order. Apply them through the Supabase dashboard SQL editor, `supabase db push`, or the Supabase MCP `apply_migration` tool. The database is the source of truth for: RLS policies, linking-code redemption, the LINE job queue (`line_jobs` + `claim_due_line_jobs`), transaction trust RPCs (`delete/restore/update_latest_line_transaction`), and the redemption rate limiter (`register_redeem_attempt`).

Migrations are forward-only. If a migration turns out wrong, write a corrective migration (see `20260903000011` replacing part of `...000007` for an example) — do not edit applied files.

## Deployment

1. Push to `main` — Vercel builds and deploys production automatically.
2. Set all environment variables in Vercel (Project → Settings → Environment Variables). `NEXT_PUBLIC_*` values are inlined at build time, so changing them requires a redeploy.
3. CI (`.github/workflows/ci.yml`) must pass on every push and pull request.

### Scheduled worker (retry sweep)

Retries must run even when no new LINE message arrives, so a Supabase pg_cron job calls `POST /api/line/worker` every minute with an `x-worker-token` header. The token lives in `line_worker_tokens` (service-role only) and is auto-bootstrapped by a migration on fresh installs; the schedule reads it dynamically, so rotation is a single `UPDATE`. Verify with `select * from cron.job_run_details order by runid desc limit 5;`. `GET /api/line/worker` (same token) returns dead-letter rows and queue depth for inspection.

`pg_net` is asynchronous — a cron run succeeding only means the HTTP request was queued. Check the actual worker responses with:

```sql
select id, status_code, timed_out, created
from net._http_response
order by created desc
limit 20;
```

To recreate the schedule on a fresh database:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.schedule('line-worker', '* * * * *', $$
  select net.http_post(
    url := 'https://<your-domain>/api/line/worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-token', (select token from public.line_worker_tokens order by created_at limit 1)
    ),
    body := '{}'::jsonb
  );
$$);
```

### Activating the LINE bot (currently dormant)

1. In the LINE Developers Console, set the webhook URL to `https://<your-domain>/api/line/webhook` and enable "Use webhook"; disable auto-reply messages.
2. On the dashboard, click **เชื่อมต่อ LINE** and send the generated `MONEY-…` code to the bot.
3. Bot commands (Thai): any expense/income shorthand, `วันนี้`, `เดือนนี้`, `ล่าสุด`, `ลบล่าสุด`, `กู้คืน` (2-minute undo window), `แก้ล่าสุด <amount>`, `ช่วย`.

### Rollback

- **App code:** `git revert <sha>` and push — Vercel deploys the reverted build; or promote a previous deployment from the Vercel dashboard.
- **Database:** forward-only corrective migrations (see above).
- **Queue:** dead jobs can be retried with `update line_jobs set status = 'retry', next_retry_at = now() where id = '…';`.

## Project structure

```
app/            routes: dashboard, history, auth, api (transactions, line webhook/link/disconnect/worker)
components/     dashboard charts, forms, history view, i18n toggle
lib/            transactions service, LINE bot + queue, parser pipeline, date/validation/i18n
supabase/       ordered SQL migrations (14 so far)
test/           vitest suites (dates, validation, redirect, signatures, parser corpus, pipeline)
```

The product specification lives in `README-personal-finance-line-bot.md`.
