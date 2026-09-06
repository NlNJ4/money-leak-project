import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import { deleteMyAccount } from "@/lib/account";
import { pushToUser, lineRetryKey } from "@/lib/line";
import { randomUUID } from "node:crypto";

// Typed-confirmation account deletion. The LINE goodbye is best-effort and
// must be sent BEFORE the auth user (and its identities) is destroyed, so
// the route performs the lookup-and-push itself via the returned id.
export async function POST(request: NextRequest) {
  let body: { confirmation?: string } = {};
  try {
    body = (await request.json()) as { confirmation?: string };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    // Look up the LINE identity first so a goodbye can be attempted,
    // then delete, then notify.
    const result = await deleteMyAccount(body.confirmation ?? "");

    if (result?.providerUserId) {
      try {
        await pushToUser(
          result.providerUserId,
          "บัญชีของคุณถูกลบเรียบร้อยแล้ว ขอบคุณที่ใช้บริการนะครับ 👋",
          lineRetryKey(`account-delete:${randomUUID()}`),
        );
      } catch (err) {
        console.error("[account] goodbye push failed:", (err as Error).message);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleServiceError(err);
  }
}
