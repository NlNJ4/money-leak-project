export function formatBaht(value: number) {
  return `${new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value)} บาท`;
}

export function formatCompactBaht(value: number) {
  return new Intl.NumberFormat("th-TH", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${new Intl.NumberFormat("th-TH", {
    maximumFractionDigits: 0,
  }).format(value)}%`;
}
