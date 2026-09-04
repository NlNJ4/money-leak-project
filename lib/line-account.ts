import "server-only";
import { lineRetryKey, pushToUser } from "@/lib/line";
import { ServiceError } from "@/lib/transactions";
import { getAuthContext } from "@/lib/supabase/server";

export async function getLineConnected(): Promise<boolean> {
  const auth = await getAuthContext();
  if (!auth) return false;

  const { data } = await auth.supabase
    .from("user_identities")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("provider", "line")
    .maybeSingle();

  return Boolean(data);
}

export async function disconnectLine(): Promise<void> {
  const auth = await getAuthContext();
  if (!auth) {
    throw new ServiceError("unauthorized");
  }

  // Delete FIRST and confirm what was removed — the web account must never
  // be told "disconnected" while the identity still works. RLS scopes this
  // to the caller's own rows.
  const { data: removed, error } = await auth.supabase
    .from("user_identities")
    .delete()
    .eq("user_id", auth.userId)
    .eq("provider", "line")
    .select("provider_user_id")
    .maybeSingle();

  if (error) {
    throw new ServiceError("delete_failed", error.message);
  }
  if (!removed) {
    throw new ServiceError("not_found");
  }

  // Only now notify the LINE side, best-effort and time-bounded; a push
  // failure (bot removed, etc.) must not affect the already-committed
  // unlink. The retry key keeps a browser retry from double-notifying.
  try {
    await pushToUser(
      removed.provider_user_id,
      "ยกเลิกการเชื่อมต่อกับบัญชีเว็บแล้วครับ\nกลับมาเชื่อมต่อใหม่ได้ที่หน้าเว็บเสมอนะครับ",
      lineRetryKey(`disconnect:${auth.userId}`),
    );
  } catch (err) {
    console.error("[line-account] disconnect notice failed:", err);
  }
}
