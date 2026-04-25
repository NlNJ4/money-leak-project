alter table public.expenses
  add column if not exists line_webhook_event_id text;

create unique index if not exists expenses_line_webhook_event_id_key
  on public.expenses (line_webhook_event_id)
  where line_webhook_event_id is not null;
