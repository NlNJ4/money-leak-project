# Money Leak Project

LINE-first personal expense tracker for quick entries like `milk tea 45` or Thai messages such as `ข้าว 55`. The app saves expenses to Supabase, replies in LINE with daily summaries, and shows a private Next.js dashboard.

## Stack

- Next.js 16 App Router
- React 19
- Tailwind CSS 4
- Supabase PostgreSQL through `@supabase/supabase-js`
- LINE Messaging API webhook
- Gemini API for flexible Thai/English intent parsing

## Environment

Create `.env.local` from `.env.example` and fill the secrets:

```bash
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000
DEFAULT_LINE_USER_ID=
DASHBOARD_ACCESS_TOKEN=
DASHBOARD_ACCESS_TOKEN_TTL_SECONDS=604800

GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview

LINE_CHANNEL_SECRET=
LINE_CHANNEL_ACCESS_TOKEN=

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never prefix it with `NEXT_PUBLIC_`.
- `DASHBOARD_ACCESS_TOKEN` is used as the signing secret for private dashboard links. Set it before production use.
- `DASHBOARD_ACCESS_TOKEN_TTL_SECONDS` controls how long a LINE dashboard link is valid. The app caps it at 7 days.
- `NEXT_PUBLIC_APP_URL` must be an HTTPS public URL when used as a LINE webhook or dashboard link outside local development.

## Supabase Setup

Run the SQL migrations in Supabase SQL Editor in timestamp order:

1. `supabase/migrations/20260425000000_initial_money_leak_schema.sql`
2. `supabase/migrations/20260425001000_add_line_webhook_event_ids.sql`

The schema enables RLS on public tables. The app writes through a trusted server-side Supabase service role client.

## LINE Setup

1. In LINE Developers, open your Messaging API channel.
2. Set webhook URL to:

```text
https://your-domain.example/api/line/webhook
```

3. Enable webhook usage.
4. Set `LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN` in `.env.local` or Vercel environment variables.
5. Send `id` or `dashboard` to the bot to get your LINE user id and private dashboard link.

For local webhook testing, use an HTTPS tunnel such as ngrok:

```bash
ngrok http 3000
```

Then use the HTTPS forwarding URL plus `/api/line/webhook`.

## Development

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm build
```

If `pnpm dev` says another Next server is running, stop the shown PID with:

```powershell
taskkill /PID <PID> /F
```

## Security Notes

- LINE webhook requests verify `x-line-signature` before JSON processing.
- Private dashboard/API access is scoped to a LINE user id using a per-user HMAC token.
- Dashboard and private API responses are marked `no-store`.
- LINE expense retries are deduplicated with `line_webhook_event_id`.
- Real production identity should eventually move to LIFF or another authenticated session flow.
