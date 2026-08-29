import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Generates a one-time code for the logged-in user to send to the LINE bot.
// 16 random bytes (128 bits) so active codes cannot be guessed.
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

  const { error } = await supabase
    .from("linking_codes")
    .upsert(
      { code, user_id: user.id, expires_at: expiresAt },
      { onConflict: "code" },
    );

  if (error) {
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ code, expiresAt });
}
