import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the Supabase auth session cookie on every matched request.
// Returns the response so callers can chain redirects onto it. `requestHeaders`
// (e.g. the CSP nonce set by proxy.ts) is FORWARDED to the server render via
// the request modifier — it must never land on the response headers.
export async function updateSession(
  request: NextRequest,
  requestHeaders: Headers,
) {
  let supabaseResponse = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request: { headers: requestHeaders },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and getClaims():
  // this call refreshes expired tokens so the server render sees a live session.
  const { data } = await supabase.auth.getClaims();

  return { supabaseResponse, userId: data?.claims.sub ?? null };
}
