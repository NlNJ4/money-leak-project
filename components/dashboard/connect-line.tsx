"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";

export function ConnectLine({ connected }: { connected: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const generate = async () => {
    setLoading(true);
    setFailed(false);
    setCopied(false);
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

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // Clipboard permission denied; the code is still visible to copy manually.
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    try {
      const response = await fetch("/api/line/disconnect", { method: "POST" });
      if (response.ok) {
        setConfirmDisconnect(false);
        router.refresh();
      }
    } catch {
      // Leave as connected; the user can retry.
    } finally {
      setDisconnecting(false);
    }
  };

  if (connected) {
    return (
      <div className="flex flex-col items-start gap-2 text-xs">
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-700">
          ✅ {t.dashboard.line.connected}
        </span>
        {confirmDisconnect ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              onClick={disconnect}
              disabled={disconnecting}
              className="rounded-md bg-rose-600 px-2.5 py-1 font-medium text-white hover:bg-rose-500 disabled:opacity-60"
            >
              {t.dashboard.line.confirmDisconnect}
            </button>
            <button
              type="button"
              onClick={() => setConfirmDisconnect(false)}
              className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-zinc-500"
            >
              {t.dashboard.form.cancel}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            className="text-zinc-400 underline-offset-2 hover:text-rose-600 hover:underline"
          >
            {t.dashboard.line.disconnect}
          </button>
        )}
      </div>
    );
  }

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
          <div className="flex items-center gap-2">
            <p className="font-mono text-base font-semibold tracking-wider text-emerald-700">
              {code}
            </p>
            <button
              type="button"
              onClick={copy}
              className="rounded-md border border-emerald-300 bg-white px-2 py-0.5 text-emerald-700 hover:bg-emerald-100"
            >
              {copied ? t.dashboard.line.copied : t.dashboard.line.copy}
            </button>
          </div>
          <p className="mt-0.5 text-emerald-600">
            {t.dashboard.line.instructions}
          </p>
        </div>
      )}
      {failed && <p className="text-red-500">{t.dashboard.line.failed}</p>}
    </div>
  );
}
