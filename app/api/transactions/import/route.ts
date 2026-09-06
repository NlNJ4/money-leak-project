import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  validateImportRows,
  type ImportRowResult,
} from "@/lib/csv-import";
import { listCategories, ServiceError } from "@/lib/transactions";
import { getAuthContext } from "@/lib/supabase/server";
import { enforceMutationRateLimit } from "@/lib/rate-limit";
import { idParamSchema } from "@/lib/validation";

// CSV import: POST with mode=preview (validate only) or mode=commit
// (insert the valid rows). The body is raw CSV text in the same format
// the export endpoint writes. Commit re-validates server-side; the client
// cannot smuggle invalid rows past this endpoint.

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (!auth) throw new ServiceError("unauthorized");
    enforceMutationRateLimit(auth.userId);

    const csv = await request.text();
    const mode = request.nextUrl.searchParams.get("mode") === "commit"
      ? "commit"
      : "preview";

    const { results, validCount } = await validateImportRows(
      csv,
      await listCategories(),
    );

    let inserted = 0;
    if (mode === "commit" && validCount > 0) {
      const valid = results.filter(
        (r): r is Extract<ImportRowResult, { ok: true }> => r.ok,
      );
      const { data: categories } = await auth.supabase
        .from("categories")
        .select("id, slug");
      const idBySlug = new Map((categories ?? []).map((c) => [c.slug, c.id]));

      const values = valid
        .map((row) => {
          const categoryId = idBySlug.get(row.category);
          if (!categoryId) return null;
          return {
            type: row.type,
            amount: row.amount,
            category_id: categoryId,
            description: row.description,
            date: row.date,
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      // The client's persistent import ID makes commit retries idempotent:
      // the marker insert + all row inserts are ONE transaction, so a lost
      // response followed by a same-ID retry returns already_imported
      // instead of duplicating rows. A failure rolls everything back.
      const importId = request.headers.get("x-import-id");
      if (!importId || !idParamSchema.safeParse(importId).success) {
        return NextResponse.json(
          { error: "import_id_required" },
          { status: 400 },
        );
      }

      const { data: result, error } = await auth.supabase.rpc(
        "import_transactions",
        {
          p_import_id: importId,
          p_user_id: auth.userId,
          p_rows: values,
        },
      );
      if (error) throw new ServiceError("insert_failed", error.message);

      const outcome = result as { status: string; inserted?: number };
      if (outcome.status === "already_imported") {
        return NextResponse.json({
          mode,
          totalRows: results.length,
          validCount,
          inserted: 0,
          alreadyImported: true,
          results,
        });
      }
      inserted = outcome.inserted ?? 0;
    }

    return NextResponse.json({
      mode,
      totalRows: results.length,
      validCount,
      inserted,
      results,
    });
  } catch (err) {
    return handleServiceError(err);
  }
}
