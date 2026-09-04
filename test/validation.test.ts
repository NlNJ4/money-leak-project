import { describe, expect, it } from "vitest";
import {
  createTransactionSchema,
  idParamSchema,
  transactionFilterSchema,
  updateTransactionSchema,
} from "@/lib/validation";

describe("createTransactionSchema", () => {
  const valid = {
    type: "expense",
    amount: 120,
    category: "food",
    description: "กินข้าว",
    date: "2026-08-29",
  };

  it("accepts a valid transaction", () => {
    expect(createTransactionSchema.safeParse(valid).success).toBe(true);
  });

  it("coerces string amounts from the web form", () => {
    const result = createTransactionSchema.safeParse({ ...valid, amount: "120" });
    expect(result.success).toBe(true);
  });

  it("rejects non-positive and oversized amounts", () => {
    expect(createTransactionSchema.safeParse({ ...valid, amount: 0 }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...valid, amount: -5 }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...valid, amount: 1_000_000_000 }).success).toBe(false);
  });

  it("rejects categories outside the fixed enum (spec section 7)", () => {
    expect(
      createTransactionSchema.safeParse({ ...valid, category: "dining" }).success,
    ).toBe(false);
  });

  it("rejects fake calendar dates (audit item 15)", () => {
    expect(createTransactionSchema.safeParse({ ...valid, date: "2026-99-99" }).success).toBe(false);
    expect(createTransactionSchema.safeParse({ ...valid, date: "2026-02-30" }).success).toBe(false);
  });

  it("rejects unknown types including postponed transfer", () => {
    expect(createTransactionSchema.safeParse({ ...valid, type: "transfer" }).success).toBe(false);
  });
});

describe("transactionFilterSchema", () => {
  it("accepts an ordered real-date range", () => {
    expect(
      transactionFilterSchema.safeParse({ from: "2026-08-01", to: "2026-08-31" }).success,
    ).toBe(true);
  });

  it("rejects fake dates and inverted ranges", () => {
    expect(
      transactionFilterSchema.safeParse({ from: "2026-99-01", to: "2026-08-31" }).success,
    ).toBe(false);
    expect(
      transactionFilterSchema.safeParse({ from: "2026-08-31", to: "2026-08-01" }).success,
    ).toBe(false);
  });
});

describe("updateTransactionSchema", () => {
  it("accepts an empty patch", () => {
    expect(updateTransactionSchema.safeParse({}).success).toBe(true);
  });

  it("accepts partial patches", () => {
    expect(updateTransactionSchema.safeParse({ amount: 80 }).success).toBe(true);
    expect(
      updateTransactionSchema.safeParse({ description: "กาแฟ" }).success,
    ).toBe(true);
  });

  it("still validates provided fields against the same rules", () => {
    expect(updateTransactionSchema.safeParse({ amount: -1 }).success).toBe(false);
    expect(updateTransactionSchema.safeParse({ category: "dining" }).success).toBe(false);
    expect(updateTransactionSchema.safeParse({ type: "transfer" }).success).toBe(false);
    expect(
      updateTransactionSchema.safeParse({ date: "2026-99-99" }).success,
    ).toBe(false);
  });
});

describe("idParamSchema", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(idParamSchema.safeParse("1b671a64-40d5-491e-99b0-da01ff1f3341").success).toBe(true);
    expect(idParamSchema.safeParse("not-a-uuid").success).toBe(false);
    expect(idParamSchema.safeParse("1; drop table transactions").success).toBe(false);
  });
});
