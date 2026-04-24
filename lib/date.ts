const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);

  return { year, month, day };
}

export function getBangkokDateKey(date = new Date()) {
  return new Date(date.getTime() + BANGKOK_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function getBangkokMonthKey(date = new Date()) {
  return getBangkokDateKey(date).slice(0, 7);
}

export function addDaysToDateKey(dateKey: string, days: number) {
  const { year, month, day } = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

export function getRecentBangkokDateKeys(dayCount: number, now = new Date()) {
  const todayKey = getBangkokDateKey(now);

  return Array.from({ length: dayCount }, (_, index) =>
    addDaysToDateKey(todayKey, index - dayCount + 1),
  );
}

export function getBangkokCalendarContext(now = new Date()) {
  const local = new Date(now.getTime() + BANGKOK_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const dayOfMonth = local.getUTCDate();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    todayKey: `${year}-${pad2(month)}-${pad2(dayOfMonth)}`,
    monthKey: `${year}-${pad2(month)}`,
    dayOfMonth,
    daysInMonth,
  };
}

export function toBangkokIso(dateKey: string, hour = 9, minute = 0) {
  const { year, month, day } = parseDateKey(dateKey);

  return new Date(Date.UTC(year, month - 1, day, hour - 7, minute)).toISOString();
}

export function formatDateKeyThai(dateKey: string) {
  const { year, month, day } = parseDateKey(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day));

  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
  }).format(date);
}
