import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";
import type { Database } from "@/types/database.types";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component: the proxy refreshes sessions,
            // so a failed cookie write here is safe to ignore.
          }
        },
      },
    },
  );
}

// Supabase recommends getClaims() for page protection because asymmetric JWTs
// are verified locally against cached public keys. React cache keeps the result
// request-scoped, so the dashboard layout, page, and data layer share one auth
// verification instead of making repeated Auth server calls.
export const getAuthContext = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || typeof claims?.sub !== "string") {
    return null;
  }

  const metadata = claims.user_metadata;
  const fullName =
    metadata &&
    typeof metadata === "object" &&
    "full_name" in metadata &&
    typeof metadata.full_name === "string"
      ? metadata.full_name
      : null;
  const email = typeof claims.email === "string" ? claims.email : null;

  return {
    supabase,
    userId: claims.sub,
    displayName: fullName ?? email?.split("@")[0] ?? "",
  };
});
