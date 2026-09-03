export default function DashboardLoading() {
  return (
    <div
      className="min-h-screen w-full bg-zinc-50 font-sans"
      role="status"
      aria-label="Loading dashboard"
    >
      <div className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
          <div className="h-5 w-36 animate-pulse rounded bg-zinc-200" />
          <div className="h-7 w-20 animate-pulse rounded-full bg-zinc-200" />
        </div>
      </div>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <div className="h-6 w-52 animate-pulse rounded bg-zinc-200" />
            <div className="h-3 w-40 animate-pulse rounded bg-zinc-200" />
          </div>
          <div className="h-9 w-28 animate-pulse rounded-lg bg-zinc-200" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-20 animate-pulse rounded-xl border border-zinc-200 bg-white"
            />
          ))}
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="h-7 w-20 animate-pulse rounded-full bg-zinc-200"
            />
          ))}
        </div>
        {[0, 1, 2].map((item) => (
          <div
            key={item}
            className="h-48 animate-pulse rounded-xl border border-zinc-200 bg-white"
          />
        ))}
        <span className="sr-only">Loading dashboard</span>
      </main>
    </div>
  );
}
