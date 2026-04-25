export function ExportCsvLink({
  accessToken,
  lineUserId,
}: {
  accessToken?: string | null;
  lineUserId: string;
}) {
  const params = new URLSearchParams({
    lineUserId,
  });

  if (accessToken) {
    params.set("accessToken", accessToken);
  }

  return (
    <a
      className="inline-flex min-h-10 items-center justify-center rounded-lg border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition hover:border-emerald-300 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      download
      href={`/api/expenses/export?${params.toString()}`}
    >
      Export CSV
    </a>
  );
}
