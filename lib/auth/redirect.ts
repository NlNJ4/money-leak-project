// Only allow same-app relative paths from the untrusted `next` query
// parameter — blocks absolute and protocol-relative external URLs (audit
// item 12).
export function safeNextPath(next: string | null | undefined): string {
  if (
    next &&
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\")
  ) {
    return next;
  }
  return "/dashboard";
}
