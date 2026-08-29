"use client";

import { locales, type Locale } from "@/lib/i18n/dictionaries";
import { useI18n } from "@/lib/i18n/provider";

const labels: Record<Locale, string> = { th: "ไทย", en: "EN" };

export function LanguageToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <div className="inline-flex rounded-full border border-zinc-200 p-0.5 text-xs">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLocale(l)}
          className={`rounded-full px-3 py-1 transition-colors ${
            l === locale
              ? "bg-zinc-900 text-white"
              : "text-zinc-500 hover:text-zinc-900"
          }`}
        >
          {labels[l]}
        </button>
      ))}
    </div>
  );
}
