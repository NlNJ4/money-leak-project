import "server-only";
import { pushToUser } from "@/lib/line";
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

  // RLS scopes the lookup to the caller's own identities.
  const { data } = await auth.supabase
    .from("user_identities")
    .select("provider_user_id")
    .eq("user_id", auth.userId)
    .eq("provider", "line")
    .maybeSingle();

  if (!data) {
    throw new ServiceError("not_found");
  }

  // Best-effort notice so the LINE side learns the connection ended; a
  // push failure (bot removed, etc.) must not block the disconnect.
  try {
    await pushToUser(
      data.provider_user_id,
      "ยกเลิกการเชื่อมต่อกับบัญชีเว็บแล้วครับ\nกลับมาเชื่อมต่อใหม่ได้ที่หน้าเว็บเสมอนะครับ",
    );
  } catch (err) {
    console.error("[line-account] disconnect notice failed:", err);
  }

  const { error } = await auth.supabase
    .from("user_identities")
    .delete()
    .eq("user_id", auth.userId)
    .eq("provider", "line");

  if (error) {
    throw new ServiceError("delete_failed", error.message);
  }
}
