import type { Locale } from "@/lib/i18n/dictionaries";

export function formatCurrency(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
}

export function formatAmountSigned(type: string, amount: number): string {
  return `${type === "expense" ? "-" : "+"}${amount.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

export function formatDate(isoDate: string, locale: Locale): string {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en-US", {
    day: "numeric",
    month: "short",
    year: locale === "en" ? "numeric" : undefined,
  }).format(date);
}
