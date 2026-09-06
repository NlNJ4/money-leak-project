import "server-only";
import { z } from "zod";
import { createTransactionSchema } from "@/lib/validation";
import { todayISO } from "@/lib/date";
import type { Category } from "@/lib/transactions";

// CSV import: parse the same format /api/transactions/export writes
// (date,type,category,description,amount,source with optional header),
// validate every row, and let the caller preview before committing.
// Row cap keeps parsing bounded; source is always forced to 'web'.

export const IMPORT_MAX_ROWS = 1_000;
export const IMPORT_MAX_BYTES = 1_000_000;

const importRowSchema = z.object({
  date: createTransactionSchema.shape.date.unwrap(),
  type: createTransactionSchema.shape.type,
  category: createTransactionSchema.shape.category,
  description: createTransactionSchema.shape.description,
  amount: createTransactionSchema.shape.amount,
});

export type ImportRowResult =
  | { row: number; ok: true; date: string; type: string; category: string; description: string; amount: number }
  | { row: number; ok: false; error: string };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      if (rows.length > IMPORT_MAX_ROWS + 1) break; // header allowance
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);

  return rows;
}

// Slugs the user can actually use (system + custom), used for membership.
export async function validateImportRows(
  csv: string,
  categories: Category[],
): Promise<{ results: ImportRowResult[]; validCount: number }> {
  const rows = parseCsv(csv);
  const results: ImportRowResult[] = [];
  const slugs = new Set(categories.map((c) => c.slug));
  const slugType = new Map(categories.map((c) => [c.slug, c.type]));

  // Skip a header row when it looks like one.
  const body =
    rows.length > 0 && rows[0][0]?.trim().toLowerCase() === "date"
      ? rows.slice(1)
      : rows;

  for (let i = 0; i < Math.min(body.length, IMPORT_MAX_ROWS); i++) {
    const cells = body[i];
    const rowNumber = i + 1;
    const [date, type, category, description, amount] = cells.map((c) =>
      c.trim(),
    );

    const parsed = importRowSchema.safeParse({
      date: date || undefined,
      type: type || undefined,
      category: category || "",
      description: description ?? "",
      amount,
    });

    if (!parsed.success) {
      results.push({
        row: rowNumber,
        ok: false,
        error: parsed.error.issues[0]?.message ?? "invalid row",
      });
      continue;
    }

    if (!slugs.has(parsed.data.category)) {
      results.push({ row: rowNumber, ok: false, error: "unknown category" });
      continue;
    }
    const categoryType = slugType.get(parsed.data.category);
    if (categoryType !== parsed.data.type) {
      results.push({ row: rowNumber, ok: false, error: "category/type mismatch" });
      continue;
    }

    results.push({
      row: rowNumber,
      ok: true,
      date: parsed.data.date ?? todayISO(),
      type: parsed.data.type,
      category: parsed.data.category,
      description: parsed.data.description,
      amount: parsed.data.amount,
    });
  }

  if (body.length > IMPORT_MAX_ROWS) {
    results.push({
      row: IMPORT_MAX_ROWS + 1,
      ok: false,
      error: `import capped at ${IMPORT_MAX_ROWS} rows per file`,
    });
  }

  return {
    results,
    validCount: results.filter((r) => r.ok).length,
  };
}
