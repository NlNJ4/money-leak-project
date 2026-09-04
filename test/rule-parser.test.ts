import { describe, expect, it } from "vitest";
import { parseWithConfidence } from "@/lib/ai/rule-parser";
import { todayISO, toISODate } from "@/lib/date";

const today = todayISO();
const yesterday = toISODate(new Date(Date.now() - 86_400_000));

type Expected = {
  type: "income" | "expense";
  amount: number;
  category: string;
  description: string;
  date: string;
  confidence: number;
};

// The roadmap's seven target messages plus real-world variations. All of
// these must resolve locally — no Gemini call — for the "works during a
// Gemini outage" goal to hold.
const corpus: Array<{ text: string; expected: Expected }> = [
  {
    text: "กินข้าว 60",
    expected: { type: "expense", amount: 60, category: "food", description: "กินข้าว", date: today, confidence: 0.9 },
  },
  {
    text: "ซื้อโกโก้ปั่น 60 บาท",
    expected: { type: "expense", amount: 60, category: "food", description: "ซื้อโกโก้ปั่น", date: today, confidence: 0.9 },
  },
  {
    text: "เติมน้ำมัน 800",
    expected: { type: "expense", amount: 800, category: "transport", description: "เติมน้ำมัน", date: today, confidence: 0.9 },
  },
  {
    text: "จ่ายค่าไฟ 1250",
    expected: { type: "expense", amount: 1250, category: "bills", description: "จ่ายค่าไฟ", date: today, confidence: 0.9 },
  },
  {
    text: "ได้เงินเดือน 30000",
    expected: { type: "income", amount: 30000, category: "salary", description: "ได้เงินเดือน", date: today, confidence: 0.9 },
  },
  {
    text: "ได้เงินคืน 450",
    expected: { type: "income", amount: 450, category: "refund", description: "ได้เงินคืน", date: today, confidence: 0.9 },
  },
  {
    text: "เมื่อวานกินข้าว 83",
    expected: { type: "expense", amount: 83, category: "food", description: "กินข้าว", date: yesterday, confidence: 0.9 },
  },
  // Variations: number formats
  {
    text: "กินข้าว ๖๐",
    expected: { type: "expense", amount: 60, category: "food", description: "กินข้าว", date: today, confidence: 0.9 },
  },
  {
    text: "กาแฟ 60.50",
    expected: { type: "expense", amount: 60.5, category: "food", description: "กาแฟ", date: today, confidence: 0.9 },
  },
  {
    text: "ของกิน 1,250",
    expected: { type: "expense", amount: 1250, category: "food", description: "ของกิน", date: today, confidence: 0.9 },
  },
  {
    text: "฿120 ค่ารถ",
    expected: { type: "expense", amount: 120, category: "transport", description: "ค่ารถ", date: today, confidence: 0.9 },
  },
  {
    text: "กินข้าว    120",
    expected: { type: "expense", amount: 120, category: "food", description: "กินข้าว", date: today, confidence: 0.9 },
  },
  // Variations: category priority
  {
    text: "จ่ายค่าน้ำมัน 500",
    expected: { type: "expense", amount: 500, category: "transport", description: "จ่ายค่าน้ำมัน", date: today, confidence: 0.9 },
  },
  {
    text: "จ่ายค่าน้ำ 300",
    expected: { type: "expense", amount: 300, category: "bills", description: "จ่ายค่าน้ำ", date: today, confidence: 0.9 },
  },
  // Income fallback: amount + income trigger, no specific category keyword
  {
    text: "ได้เงิน 2000",
    expected: { type: "income", amount: 2000, category: "other_income", description: "ได้เงิน", date: today, confidence: 0.75 },
  },
  // Expense fallback stays local only when an explicit transaction verb is present
  {
    text: "ซื้อ 200",
    expected: { type: "expense", amount: 200, category: "other", description: "ซื้อ", date: today, confidence: 0.75 },
  },
  {
    text: "จ่าย 150",
    expected: { type: "expense", amount: 150, category: "other", description: "จ่าย", date: today, confidence: 0.75 },
  },
  // Amount suffixes fold into plain numbers
  {
    text: "ซื้อไอเทม 60k",
    expected: { type: "expense", amount: 60000, category: "other", description: "ซื้อไอเทม", date: today, confidence: 0.75 },
  },
  {
    text: "กินข้าว 1พัน",
    expected: { type: "expense", amount: 1000, category: "food", description: "กินข้าว", date: today, confidence: 0.9 },
  },
  {
    text: "โบนัส 2 ล้าน",
    expected: { type: "income", amount: 2000000, category: "other_income", description: "โบนัส", date: today, confidence: 0.75 },
  },
];

describe("parseWithConfidence — local corpus", () => {
  for (const { text, expected } of corpus) {
    it(`parses "${text}"`, () => {
      const { parsed, confidence } = parseWithConfidence(text);
      expect(parsed).not.toBeNull();
      expect(confidence).toBeGreaterThanOrEqual(expected.confidence);
      expect(parsed).toEqual({
        type: expected.type,
        amount: expected.amount,
        category: expected.category,
        description: expected.description,
        date: expected.date,
      });
    });
  }
});

describe("parseWithConfidence — escalates to Gemini instead of guessing", () => {
  it("returns null for non-transaction chatter", () => {
    const result = parseWithConfidence("สวัสดีครับ");
    expect(result.parsed).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns low confidence when several numbers make the amount ambiguous", () => {
    const result = parseWithConfidence("กินข้าว 60 บาท อีก 40");
    expect(result.parsed).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("caps confidence when the text names an explicit date the rules cannot resolve", () => {
    const result = parseWithConfidence("วันจันทร์กินข้าว 200");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("does not auto-save a bare amount with no description", () => {
    const result = parseWithConfidence("120");
    expect(result.parsed).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("rejects a zero amount", () => {
    const result = parseWithConfidence("กินข้าว 0");
    expect(result.parsed).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("rejects conversational times like เจอกัน 5 โมง", () => {
    for (const text of ["เจอกัน 5 โมง", "นัดเจอ 7 ครึ่ง", "คุยกัน 10 นาที"]) {
      const result = parseWithConfidence(text);
      expect(result.confidence, text).toBeLessThan(0.7);
    }
  });

  it("escalates counts without a transaction verb or category keyword", () => {
    const result = parseWithConfidence("เจอกัน 5 คน");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("never silently strips a negative sign", () => {
    const result = parseWithConfidence("กินข้าว -100");
    expect(result.parsed).toBeNull();
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("escalates percentage amounts", () => {
    const result = parseWithConfidence("ดอกเบี้ย 3%");
    expect(result.confidence).toBeLessThan(0.7);
  });

  it("does not fold kilometer-like words into amounts", () => {
    // "5km" must not become 5000 — only a bare k suffix folds.
    const result = parseWithConfidence("วิ่ง 5km");
    expect(result.confidence).toBeLessThan(0.7);
  });
});
