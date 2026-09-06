// CSV quoting alone does not prevent spreadsheet formula execution. Treat
// untrusted text as text, including formulas preceded by whitespace/control
// characters. Numeric values stay numeric.
export function csvCell(value: string | number | null | undefined): string {
  let text = String(value ?? "");
  if (
    typeof value === "string" &&
    (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text))
  ) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
