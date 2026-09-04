// All "today"/period boundaries use one explicit application timezone so a
// UTC-hosted server still agrees with Bangkok wall-clock time (audit item 9).
export const APP_TIMEZONE = "Asia/Bangkok";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISODate(date: Date, tz: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayISO(): string {
  return toISODate(new Date());
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

type Range = { from: string; to: string };

export function todayRange(): Range {
  const today = todayISO();
  return { from: today, to: today };
}

export function weekRange(): Range {
  // Sunday-based week containing "today" in the app timezone.
  const todayUtc = new Date(`${todayISO()}T00:00:00Z`);
  const start = new Date(todayUtc);
  start.setUTCDate(start.getUTCDate() - todayUtc.getUTCDay());
  return { from: toISODate(start, "UTC"), to: todayISO() };
}

export function monthRange(date = new Date(), tz: string = APP_TIMEZONE): Range {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const year = get("year");
  const month = get("month");
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

// Default history window: the trailing year, ending today.
export function yearAgoRange(): Range {
  const to = todayISO();
  const from = toISODate(new Date(Date.now() - 365 * 86_400_000));
  return { from, to };
}
