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

# Product Scope

- Main flow: user sends a short LINE message such as `ชานม 45` or `milk tea 45`; the webhook parses title, amount, and category; the expense is saved; the bot replies with a daily summary; the dashboard shows spending insights.
- MVP features: LINE expense entry, keyword-based category detection, daily and monthly budgets, dashboard cards/charts, recent expenses, leak detector, and simple recommendations.
- Recommended stack from the reference: Next.js App Router, Route Handlers, Tailwind CSS, LINE Messaging API, Prisma, PostgreSQL on Supabase or Neon, Recharts or Chart.js, and Vercel.
- Suggested folders: `app/api/line/webhook/route.ts`, `app/api/expenses/route.ts`, `app/api/summary/route.ts`, `app/dashboard/page.tsx`, `lib/parser.ts`, `lib/analyze.ts`, `lib/expense-service.ts`, `lib/db.ts`, and `prisma/schema.prisma`.

# Engineering Standards

- Follow current Next.js 16 best practices from the local docs before implementing pages, layouts, route handlers, caching, data fetching, config, or server/client component boundaries.
- Prefer reusable, well-named components for repeated UI patterns such as summary cards, charts, expense rows, empty states, budget progress, and leak insights.
- Keep reusable components focused and composable. Pass data through typed props, avoid hidden global state, and keep component-specific styling close to the component.
- Keep business logic out of UI components. Put parsing, categorization, summary calculations, leak scoring, and database operations in `lib/` or service modules.
- Avoid premature abstraction. Extract a reusable component or helper when a pattern repeats, when it clarifies intent, or when it reduces meaningful duplication.
- Prefer server components by default. Add `"use client"` only for interactive UI, browser APIs, chart libraries that require the client, or local component state.
- Keep route handlers thin: validate input, verify auth/signatures, call domain/service logic, and return a clear response.
- Use TypeScript types for shared data shapes such as expenses, budgets, categories, summaries, and leak analysis results.
- Design components for Thai-first copy and mobile dashboard usage, with accessible labels, readable currency formatting, and responsive layouts.

# Security And Privacy

- Verify the `x-line-signature` header before processing LINE webhook requests.
- Keep `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `DATABASE_URL`, and app URLs in environment variables. Do not commit secrets.
- Scope every user-facing query by LINE `userId` or the authenticated user identifier.
- Validate expense input: amount must be a positive number and text must match a supported format.
- Treat route handlers as public HTTP endpoints. Add error handling and rate limiting when the endpoint can be spammed.

# Change Discipline

- Do not touch existing application code that depends on Next.js 16 behavior unless the user asks for that change or it is required for the current task.
- Do not opportunistically migrate, rename, or "fix" unrelated Next.js APIs. Keep edits scoped to the request.
- If existing code uses a Next.js 16 API you do not recognize, read the local docs first, then make the smallest compatible change.
- Do not restore, recreate, or overwrite deleted reference files unless the user explicitly asks.

# Local Verification

Before making framework-specific changes, inspect `package.json` and the lockfile to confirm the installed Next.js, React, Prisma, and related package versions. Treat installed dependencies as the source of truth.

If `node_modules/next/dist/docs/` is missing, do not guess Next.js 16 behavior. Install dependencies first or limit the change to non-framework-specific code.

# Common Commands

Use the package manager already used by the project lockfile.

- Development: `pnpm dev`
- Build: `pnpm build`
- Lint: `pnpm lint`
- Type check: `pnpm tsc --noEmit`
- Prisma generate: `pnpm prisma generate`
- Prisma migrate dev: `pnpm prisma migrate dev`

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

# Dashboard Access

- Dashboard pages and APIs must never return expenses across all users unless explicitly in demo/admin mode.
- Prefer authenticated access or LIFF-based LINE identity for user dashboards.
- If a demo dashboard is needed, use seeded demo data and label it clearly as demo data.
