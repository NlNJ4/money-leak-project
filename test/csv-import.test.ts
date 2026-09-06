import { describe, expect, it } from "vitest";
import {
  parseCsv,
  validateImportRows,
} from "@/lib/csv-import";
import type { Category } from "@/lib/transactions";

const categories: Category[] = [
  { id: "1", slug: "food", name_th: "อาหาร", name_en: "Food", icon: "🍜", type: "expense" },
  { id: "2", slug: "salary", name_th: "เงินเดือน", name_en: "Salary", icon: "💰", type: "income" },
];

describe("parseCsv", () => {
  it("handles quoted commas and CRLF", () => {
    const rows = parseCsv('date,type,category,description,amount,source\r\n2026-09-01,expense,food,"kao, pad",120,web\r\n');
    expect(rows).toHaveLength(2);
    expect(rows[1][3]).toBe("kao, pad");
  });

  it("treats doubled quotes as an escaped quote", () => {
    const rows = parseCsv('2026-09-01,expense,food,"say ""hi""",120,web');
    expect(rows[0][3]).toBe('say "hi"');
  });
});

describe("validateImportRows", () => {
  const csv = [
    "date,type,category,description,amount,source",
    "2026-09-01,expense,food,lunch,120,web",
    "2026-09-02,income,salary,payday,30000,web",
    "2026-13-40,expense,food,fake date,5,web",
    "2026-09-03,expense,travel,unknown slug,10,web",
    "2026-09-04,expense,salary,swapped type,10,web",
    "2026-09-05,expense,food,negative,-3,web",
  ].join("\n");

  it("validates each row and classifies ok/error", async () => {
    const { results, validCount } = await validateImportRows(csv, categories);

    expect(results).toHaveLength(6);
    expect(validCount).toBe(2);
    expect(results[0]).toMatchObject({ ok: true, category: "food", amount: 120 });
    expect(results[1]).toMatchObject({ ok: true, category: "salary" });
    expect(results[2]).toMatchObject({ ok: false });
    expect(results[3]).toMatchObject({ ok: false, error: "unknown category" });
    expect(results[4]).toMatchObject({ ok: false, error: "category/type mismatch" });
    expect(results[5]).toMatchObject({ ok: false });
  });

  it("accepts files without a header row and blank descriptions", async () => {
    const { results, validCount } = await validateImportRows(
      "2026-09-01,expense,food,,80,web",
      categories,
    );
    expect(validCount).toBe(1);
    expect(results[0]).toMatchObject({ ok: true, description: "", amount: 80 });
  });
});
