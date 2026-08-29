"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

export function ConnectLine() {
  const { t } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const generate = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const response = await fetch("/api/line/link", { method: "POST" });
      if (!response.ok) {
        setFailed(true);
        return;
      }
      const payload = await response.json();
      setCode(payload.code);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-start gap-2 text-xs">
      <button
        type="button"
        onClick={generate}
        disabled={loading}
        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-medium text-zinc-600 transition-colors hover:text-zinc-900 disabled:opacity-60"
      >
        {loading ? "..." : `💬 ${t.dashboard.line.connect}`}
      </button>

      {code && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="font-mono text-base font-semibold tracking-wider text-emerald-700">
            {code}
          </p>
          <p className="mt-0.5 text-emerald-600">
            {t.dashboard.line.instructions}
          </p>
        </div>
      )}
      {failed && <p className="text-red-500">{t.dashboard.line.failed}</p>}
    </div>
  );
}
