function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayISO(): string {
  return toISODate(new Date());
}

type Range = { from: string; to: string };

export function todayRange(): Range {
  const today = todayISO();
  return { from: today, to: today };
}

export function weekRange(): Range {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay()); // Sunday-based week
  const end = new Date(now);
  return { from: toISODate(start), to: toISODate(end) };
}

export function monthRange(date = new Date()): Range {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { from: toISODate(start), to: toISODate(end) };
}

export function isValidISODate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
