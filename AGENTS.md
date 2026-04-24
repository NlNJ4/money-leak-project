<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This project uses Next.js 16.2.4 and React 19.2.4. APIs, conventions, and file structure may differ from your training data. Before writing or refactoring any Next.js code, read the specific local guide in `node_modules/next/dist/docs/` that matches the task. Heed deprecation notices.

Useful starting points for this project:

- `node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md`
- `node_modules/next/dist/docs/01-app/02-guides/backend-for-frontend.md`
- Any component, config, routing, or data-fetching doc for the exact API being touched

<!-- END:nextjs-agent-rules -->

# Project Reference

Use `.codex/reference/money_leak_project_docs.docx` as the product reference. It describes a LINE Bot plus Next.js fullstack web dashboard for tracking small personal expenses, finding recurring "money leaks", and showing budget insights.

The reference document may mention Prisma in some places. For this codebase, Supabase is the chosen data layer. If this file conflicts with the reference document on database implementation, follow this `AGENTS.md` and use Supabase.

# Product Scope

- Main flow: user sends a short LINE message such as `ชานม 45` or `milk tea 45`; the webhook parses title, amount, and category; the expense is saved; the bot replies with a daily summary; the dashboard shows spending insights.
- MVP features: LINE expense entry, keyword-based category detection, daily and monthly budgets, dashboard cards/charts, recent expenses, leak detector, and simple recommendations.
- Recommended stack: Next.js App Router, Route Handlers, Tailwind CSS, LINE Messaging API, Supabase PostgreSQL, `@supabase/supabase-js`, `@supabase/ssr` when SSR auth is needed, Recharts or Chart.js, and Vercel.
- Suggested folders: `app/api/line/webhook/route.ts`, `app/api/expenses/route.ts`, `app/api/summary/route.ts`, `app/dashboard/page.tsx`, `lib/parser.ts`, `lib/analyze.ts`, `lib/expense-service.ts`, `lib/summary-service.ts`, `lib/supabase/admin.ts`, `lib/supabase/server.ts`, `lib/supabase/client.ts`, `types/database.types.ts`, and `supabase/migrations/*.sql`.

# Engineering Standards

- Follow current Next.js 16 best practices from the local docs before implementing pages, layouts, route handlers, caching, data fetching, config, or server/client component boundaries.
- Prefer reusable, well-named components for repeated UI patterns such as summary cards, charts, expense rows, empty states, budget progress, and leak insights.
- Keep reusable components focused and composable. Pass data through typed props, avoid hidden global state, and keep component-specific styling close to the component.
- Keep business logic out of UI components. Put parsing, categorization, summary calculations, leak scoring, and database operations in `lib/` or service modules.
- Keep Supabase queries inside service modules such as `lib/expense-service.ts`, `lib/summary-service.ts`, and `lib/budget-service.ts`.
- Do not scatter raw Supabase queries throughout UI components.
- Avoid premature abstraction. Extract a reusable component or helper when a pattern repeats, when it clarifies intent, or when it reduces meaningful duplication.
- Prefer server components by default. Add `"use client"` only for interactive UI, browser APIs, chart libraries that require the client, or local component state.
- Keep route handlers thin: validate input, verify auth/signatures, call domain/service logic, and return a clear response.
- Use TypeScript types for shared data shapes such as expenses, budgets, categories, summaries, and leak analysis results.
- Generate and use Supabase database types in `types/database.types.ts`.
- Design components for Thai-first copy and mobile dashboard usage, with accessible labels, readable currency formatting, and responsive layouts.

# Security And Privacy

- Verify the `x-line-signature` header before processing LINE webhook requests.
- Keep `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and app URLs in environment variables.
- Do not commit secrets.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- `SUPABASE_SERVICE_ROLE_KEY` must not use the `NEXT_PUBLIC_` prefix.
- Use the Supabase service role key only in trusted server-side code such as LINE webhook route handlers and server-only service modules.
- Use browser-safe Supabase keys only in client components.
- Enable RLS for tables that are accessed directly from browser clients.
- Scope every user-facing query by LINE `userId`, Supabase authenticated user id, or another authenticated user identifier.
- Validate expense input: amount must be a positive number and text must match a supported format.
- Treat route handlers as public HTTP endpoints. Add error handling and rate limiting when the endpoint can be spammed.
- Do not expose raw Supabase/database errors directly to public API responses.

# Change Discipline

- Do not touch existing application code that depends on Next.js 16 behavior unless the user asks for that change or it is required for the current task.
- Do not opportunistically migrate, rename, or "fix" unrelated Next.js APIs. Keep edits scoped to the request.
- If existing code uses a Next.js 16 API you do not recognize, read the local docs first, then make the smallest compatible change.
- Do not restore, recreate, or overwrite deleted reference files unless the user explicitly asks.
- Do not add Prisma or `prisma/schema.prisma` unless the user explicitly asks for Prisma.

# Local Verification

Before making framework-specific changes, inspect `package.json` and the lockfile to confirm the installed Next.js, React, Supabase, LINE SDK, charting, and related package versions. Treat installed dependencies as the source of truth.

If `node_modules/next/dist/docs/` is missing, do not guess Next.js 16 behavior. Install dependencies first or limit the change to non-framework-specific code.

# Common Commands

Use the package manager already used by the project lockfile.

- Development: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Type check: `pnpm tsc --noEmit`
- Start local Supabase: `pnpm supabase start`
- Stop local Supabase: `pnpm supabase stop`
- Create Supabase migration: `pnpm supabase migration new <name>`
- Reset/apply local Supabase migrations: `pnpm supabase db reset`
- Generate local Supabase DB types: `pnpm supabase gen types typescript --local > types/database.types.ts`

Adjust commands only if the project lockfile or `package.json` scripts show a different package manager.

# Date And Time

- Treat user-facing daily and monthly summaries as Asia/Bangkok time.
- Do not rely on server UTC boundaries for “today”, “this week”, or “this month”.
- Centralize date range helpers in `lib/date.ts`.

# LINE Webhook Notes

- Read the raw request body before parsing JSON so `x-line-signature` verification uses the exact request payload.
- Verify the LINE signature before processing any event.
- Keep the webhook route on the Node.js runtime unless local Next.js docs and dependencies confirm Edge compatibility.
- Handle unsupported message types gracefully.
- Reply tokens are for immediate replies only and must not be stored for later use.
- If an event has no `source.userId`, do not create an expense. Reply with a graceful error or ignore the event.

# Dashboard Access

- Dashboard pages and APIs must never return expenses across all users unless explicitly in demo/admin mode.
- Prefer authenticated access or LIFF-based LINE identity for user dashboards.
- If a demo dashboard is needed, use seeded demo data and label it clearly as demo data.
- Demo data must be separated from real LINE user data.
- Every dashboard query must be scoped by `line_user_id`, authenticated Supabase user id, or clearly labeled demo mode.

# Database And Supabase

This project uses Supabase instead of Prisma.

- Use Supabase PostgreSQL as the database layer through `@supabase/supabase-js`.
- Do not add Prisma or `prisma/schema.prisma` unless the user explicitly asks for it.
- Store schema changes as SQL migrations under `supabase/migrations/`.
- Keep Supabase access centralized in `lib/supabase/` and service modules.
- Use `lib/supabase/admin.ts` for server-only Supabase access with the service role key.
- Use `lib/supabase/server.ts` for SSR/auth-aware server access when needed.
- Use `lib/supabase/client.ts` for browser-safe access with the publishable key when needed.
- Generate TypeScript database types after schema changes and store them in `types/database.types.ts`.
- Store money values as integer baht amounts for the MVP, for example `amount_baht = 45`.
- Every expense row must belong to a `line_user_id` or authenticated user identifier.
- Add indexes for common query patterns such as `(line_user_id, spent_at)` and `(line_user_id, category)`.
- Do not expose raw Supabase errors directly to public API responses.

Suggested MVP tables:

- `line_users`
- `expenses`
- `budgets` or budget fields on `line_users`

Suggested `expenses` fields:

- `id`
- `line_user_id`
- `title`
- `amount_baht`
- `category`
- `is_need`
- `spent_at`
- `created_at`
