export const locales = ["th", "en"] as const;
export type Locale = (typeof locales)[number];
export const LOCALE_COOKIE = "locale";
export const DEFAULT_LOCALE: Locale = "th";

const th = {
  appName: "รายรับ–รายจ่าย",
  login: {
    title: "บันทึกเงิน ง่ายเหมือนส่งข้อความ",
    subtitle: "เข้าสู่ระบบเพื่อดูภาพรวมรายรับ–รายจ่ายของคุณ",
    signInWithGoogle: "เข้าสู่ระบบด้วย Google",
    error: "เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
  },
  nav: {
    signOut: "ออกจากระบบ",
  },
  dashboard: {
    title: "ภาพรวม",
    greeting: "สวัสดี",
    income: "รายรับ",
    expense: "รายจ่าย",
    net: "สุทธิ",
    period: {
      today: "วันนี้",
      thisWeek: "สัปดาห์นี้",
      thisMonth: "เดือนนี้",
      custom: "กำหนดเอง",
      from: "จาก",
      to: "ถึง",
      apply: "ใช้ตัวกรอง",
    },
    categoryBreakdown: "แยกตามหมวด",
    recentTransactions: "รายการล่าสุด",
    addTransaction: "เพิ่มรายการ",
    charts: {
      daily: "รายวัน",
      noData: "ยังไม่มีข้อมูลในช่วงนี้",
    },
    line: {
      connect: "เชื่อมต่อ LINE",
      instructions: "ส่งโค้ดนี้ไปที่ LINE Bot ของคุณภายใน 15 นาที",
      failed: "ขอโค้ดไม่สำเร็จ กรุณาลองอีกครั้ง",
    },
    form: {
      title: "เพิ่มรายการใหม่",
      editTitle: "แก้ไขรายการ",
      type: "ประเภท",
      typeExpense: "รายจ่าย",
      typeIncome: "รายรับ",
      amount: "จำนวนเงิน",
      category: "หมวด",
      description: "รายละเอียด",
      date: "วันที่",
      save: "บันทึก",
      saving: "กำลังบันทึก...",
      cancel: "ยกเลิก",
    },
    recent: {
      edit: "แก้ไขรายการนี้",
      delete: "ลบรายการนี้",
      confirmDelete: "ลบ",
      cancelDelete: "ไม่ลบ",
    },
    empty: "ยังไม่มีรายการในช่วงนี้",
    errors: {
      generic: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง",
    },
  },
};

const en: Dictionary = {
  appName: "Personal Finance",
  login: {
    title: "Track money like sending a message",
    subtitle: "Sign in to see your income and expense overview",
    signInWithGoogle: "Sign in with Google",
    error: "Sign-in failed. Please try again.",
  },
  nav: {
    signOut: "Sign out",
  },
  dashboard: {
    title: "Overview",
    greeting: "Hello",
    income: "Income",
    expense: "Expense",
    net: "Net",
    period: {
      today: "Today",
      thisWeek: "This week",
      thisMonth: "This month",
      custom: "Custom",
      from: "From",
      to: "To",
      apply: "Apply",
    },
    categoryBreakdown: "By category",
    recentTransactions: "Recent transactions",
    addTransaction: "Add transaction",
    charts: {
      daily: "Daily",
      noData: "No data for this period",
    },
    line: {
      connect: "Connect LINE",
      instructions: "Send this code to your LINE bot within 15 minutes",
      failed: "Could not generate a code. Please try again.",
    },
    form: {
      title: "New transaction",
      editTitle: "Edit transaction",
      type: "Type",
      typeExpense: "Expense",
      typeIncome: "Income",
      amount: "Amount",
      category: "Category",
      description: "Description",
      date: "Date",
      save: "Save",
      saving: "Saving...",
      cancel: "Cancel",
    },
    recent: {
      edit: "Edit this transaction",
      delete: "Delete this transaction",
      confirmDelete: "Delete",
      cancelDelete: "Keep",
    },
    empty: "No transactions in this period",
    errors: {
      generic: "Something went wrong. Please try again.",
    },
  },
};

export type Dictionary = typeof th;

export const dictionaries: Record<Locale, Dictionary> = { th, en };

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}
