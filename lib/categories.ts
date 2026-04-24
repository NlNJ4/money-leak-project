import type { ExpenseCategory } from "@/lib/types";

type CategoryConfig = {
  label: string;
  shortLabel: string;
  color: string;
  keywords: string[];
  leakProne: boolean;
};

export const categoryOrder: ExpenseCategory[] = [
  "food",
  "drinks",
  "delivery",
  "transport",
  "shopping",
  "subscriptions",
  "other",
];

export const categoryConfig: Record<ExpenseCategory, CategoryConfig> = {
  food: {
    label: "อาหาร",
    shortLabel: "อาหาร",
    color: "#2563eb",
    keywords: [
      "ข้าว",
      "ก๋วยเตี๋ยว",
      "อาหาร",
      "หมู",
      "ไก่",
      "rice",
      "noodle",
      "lunch",
      "dinner",
      "meal",
    ],
    leakProne: false,
  },
  drinks: {
    label: "เครื่องดื่ม",
    shortLabel: "ดื่ม",
    color: "#0891b2",
    keywords: [
      "ชานม",
      "กาแฟ",
      "ลาเต้",
      "ชา",
      "น้ำ",
      "coffee",
      "latte",
      "tea",
      "milk tea",
      "boba",
    ],
    leakProne: true,
  },
  delivery: {
    label: "เดลิเวอรี",
    shortLabel: "ส่ง",
    color: "#dc2626",
    keywords: [
      "grab",
      "lineman",
      "line man",
      "ค่าส่ง",
      "ส่งอาหาร",
      "เดลิเวอรี",
      "delivery",
    ],
    leakProne: true,
  },
  transport: {
    label: "เดินทาง",
    shortLabel: "ทาง",
    color: "#7c3aed",
    keywords: [
      "รถ",
      "bts",
      "mrt",
      "วิน",
      "แท็กซี่",
      "taxi",
      "bus",
      "train",
      "transport",
    ],
    leakProne: false,
  },
  shopping: {
    label: "ของจุกจิก",
    shortLabel: "จุกจิก",
    color: "#d97706",
    keywords: [
      "ของ",
      "ขนม",
      "snack",
      "shop",
      "shopping",
      "shopee",
      "lazada",
      "จุกจิก",
    ],
    leakProne: true,
  },
  subscriptions: {
    label: "สมาชิก",
    shortLabel: "สมาชิก",
    color: "#475569",
    keywords: [
      "netflix",
      "spotify",
      "youtube",
      "subscription",
      "สมาชิก",
      "รายเดือน",
      "sub",
    ],
    leakProne: true,
  },
  other: {
    label: "อื่น ๆ",
    shortLabel: "อื่น",
    color: "#059669",
    keywords: [],
    leakProne: false,
  },
};

export function getCategoryLabel(category: ExpenseCategory) {
  return categoryConfig[category].label;
}
