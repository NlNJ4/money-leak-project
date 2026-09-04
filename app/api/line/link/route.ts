import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Generates a one-time code for the logged-in user to send to the LINE bot.
// 16 random bytes (128 bits) so active codes cannot be guessed. Issuance is
// one atomic RPC (delete old codes + insert) so concurrent requests can
// never leave multiple active codes; the DB also enforces one code per user.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const code = `MONEY-${randomBytes(16).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { error } = await createAdminClient().rpc("create_linking_code", {
    p_user_id: user.id,
    p_code: code,
    p_expires_at: expiresAt,
  });

  if (error) {
    console.error("[line link] create_linking_code failed:", error.message);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ code, expiresAt });
}
