import { describe, expect, it } from "vitest";
import { parseHistoryCursor } from "@/lib/transactions";

const ID = "1b671a64-40d5-491e-99b0-da01ff1f3341";

describe("parseHistoryCursor", () => {
  it("accepts a real Supabase timestamp and UUID", () => {
    expect(parseHistoryCursor(`2026-09-04T10:30:45.123+07:00|${ID}`)).toEqual({
      createdAt: "2026-09-04T10:30:45.123+07:00",
      id: ID,
    });
  });

  it("rejects impossible timestamps and extra cursor parts", () => {
    expect(parseHistoryCursor(`2026-02-30T10:30:45Z|${ID}`)).toBeUndefined();
    expect(parseHistoryCursor(`2026-09-04T25:30:45Z|${ID}`)).toBeUndefined();
    expect(parseHistoryCursor(`2026-09-04T10:30:45Z|${ID}|extra`)).toBeUndefined();
  });
});
