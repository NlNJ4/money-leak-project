import { NextResponse, type NextRequest } from "next/server";
import { handleServiceError } from "@/app/api/transactions/http";
import {
  validateImportRows,
  type ImportRowResult,
} from "@/lib/csv-import";
import { listCategories, ServiceError } from "@/lib/transactions";
import { getAuthContext } from "@/lib/supabase/server";

// CSV import: POST with mode=preview (validate only) or mode=commit
// (insert the valid rows). The body is raw CSV text in the same format
// the export endpoint writes. Commit re-validates server-side; the client
// cannot smuggle invalid rows past this endpoint.

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthContext();
    if (!auth) throw new ServiceError("unauthorized");

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
            user_id: auth.userId,
            type: row.type,
            amount: row.amount,
            category_id: categoryId,
            description: row.description,
            transaction_date: row.date,
            source: "web",
          };
        })
        .filter((v): v is NonNullable<typeof v> => v !== null);

      for (let i = 0; i < values.length; i += 500) {
        const chunk = values.slice(i, i + 500);
        const { error } = await auth.supabase
          .from("transactions")
          .insert(chunk);
        if (error) throw new ServiceError("insert_failed", error.message);
        inserted += chunk.length;
      }
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
