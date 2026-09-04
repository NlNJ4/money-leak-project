// Extracts the local Supabase stack credentials from `supabase status -o json`
// and prints GITHUB_ENV lines. CLI versions have shipped different key names,
// so several candidates are probed; the documented local demo keys are the
// final fallback (valid only against localhost, safe to embed).
import { execFileSync } from "node:child_process";

const WELL_KNOWN = {
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_ANON_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0",
  SUPABASE_SERVICE_ROLE_KEY:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0Y6NwVAS",
};

const CANDIDATES = {
  SUPABASE_URL: ["SUPABASE_URL", "SB_URL", "API URL", "studioUrl"],
  SUPABASE_ANON_KEY: ["SUPABASE_ANON_KEY", "SB_ANON_KEY", "ANON_KEY", "anon key"],
  SUPABASE_SERVICE_ROLE_KEY: [
    "SUPABASE_SERVICE_ROLE_KEY",
    "SB_SERVICE_ROLE_KEY",
    "SERVICE_ROLE_KEY",
    "service_role key",
  ],
};

function pick(status, candidates) {
  for (const key of candidates) {
    if (typeof status[key] === "string" && status[key].length > 0) {
      return status[key];
    }
  }
  return undefined;
}

let status;
try {
  const raw = execFileSync("supabase", ["status", "-o", "json"], {
    encoding: "utf8",
    timeout: 60_000,
  });
  status = JSON.parse(raw);
  if (Array.isArray(status)) status = status[0] ?? {};
} catch {
  status = {};
}

const resolved = {};
for (const [name, candidates] of Object.entries(CANDIDATES)) {
  const value = pick(status, candidates) ?? WELL_KNOWN[name];
  resolved[name] = value;
  console.log(`${name}=${value}`);
}

if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/.test(resolved.SUPABASE_URL)) {
  // The stack always binds loopback; anything else means we parsed junk.
  console.error(`refusing non-loopback SUPABASE_URL: ${resolved.SUPABASE_URL}`);
  process.exit(1);
}
