import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { verifyLineSignature } from "@/lib/line";

const SECRET = "test-channel-secret";

function sign(body: string): string {
  return createHmac("sha256", SECRET).update(body, "utf8").digest("base64");
}

describe("verifyLineSignature (audit item 1 companion)", () => {
  const body = '{"events":[]}';

  it("accepts a correctly signed body", () => {
    expect(verifyLineSignature(SECRET, body, sign(body))).toBe(true);
  });

  it("rejects missing, wrong, or foreign-key signatures", () => {
    expect(verifyLineSignature(SECRET, body, null)).toBe(false);
    expect(verifyLineSignature(SECRET, body, "badbadbad")).toBe(false);
    expect(verifyLineSignature(SECRET, body + " ", sign(body))).toBe(false);
    expect(verifyLineSignature("other-secret", body, sign(body))).toBe(false);
  });
});
