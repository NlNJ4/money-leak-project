import { describe, expect, it } from "vitest";
import { isValidISODate, monthRange, toISODate, todayISO, weekRange } from "@/lib/date";

describe("isValidISODate", () => {
  it("accepts real dates", () => {
    expect(isValidISODate("2026-08-29")).toBe(true);
    expect(isValidISODate("2024-02-29")).toBe(true); // leap year
  });

  it("rejects malformed values (audit item 15)", () => {
    expect(isValidISODate("2026-99-99")).toBe(false);
    expect(isValidISODate("2026-13-01")).toBe(false);
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("29-08-2026")).toBe(false);
    expect(isValidISODate("")).toBe(false);
  });
});

describe("Bangkok timezone helpers (audit item 9)", () => {
  it("formats a UTC instant as the Bangkok calendar date", () => {
    // 2026-08-29 18:00 UTC is already 2026-08-30 in Bangkok (+07:00).
    const instant = new Date("2026-08-29T18:00:00Z");
    expect(toISODate(instant, "UTC")).toBe("2026-08-29");
    expect(toISODate(instant, "Asia/Bangkok")).toBe("2026-08-30");
  });

  it("uses Bangkok for today", () => {
    expect(todayISO()).toBe(toISODate(new Date(), "Asia/Bangkok"));
  });

  it("computes month bounds in Bangkok", () => {
    // A moment that is August in UTC but September in Bangkok.
    const instant = new Date("2026-08-31T18:00:00Z");
    expect(monthRange(instant)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(monthRange(new Date("2026-02-10T12:00:00Z"))).toEqual({
      from: "2026-02-01",
      to: "2026-02-28",
    });
  });

  it("computes a Sunday-based week containing today", () => {
    const range = weekRange();
    expect(range.from <= range.to).toBe(true);
    expect(isValidISODate(range.from)).toBe(true);
  });
});
