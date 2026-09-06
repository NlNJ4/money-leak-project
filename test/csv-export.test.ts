import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/csv-export";

describe("CSV spreadsheet safety", () => {
  it.each(["=1+1", "+1+1", "-1+1", "@SUM(A1)", "  =1+1", "\t=1+1"])("neutralizes formula text %j", (input) => {
    expect(csvCell(input)).toBe(`'${input}`);
  });
  it("quotes carriage returns, newlines, commas, and quotes", () => {
    expect(csvCell("a\rb")).toBe('"a\rb"');
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("preserves Thai text, dates, and numeric values", () => {
    expect(csvCell("ข้าว 60 บาท")).toBe("ข้าว 60 บาท");
    expect(csvCell("2026-09-06")).toBe("2026-09-06");
    expect(csvCell(60)).toBe("60");
    expect(csvCell(-60)).toBe("-60");
  });
});
