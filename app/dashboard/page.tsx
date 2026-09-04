import { DashboardView } from "@/components/dashboard/dashboard-view";
import { isValidISODate, monthRange, todayRange, weekRange } from "@/lib/date";
import { getLineConnected } from "@/lib/line-account";
import { getAuthContext } from "@/lib/supabase/server";
import { getDashboardData, listCategories } from "@/lib/transactions";

const PERIODS = ["today", "week", "month", "custom"] as const;
type Period = (typeof PERIODS)[number];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const period: Period = PERIODS.includes(params.period as Period)
    ? (params.period as Period)
    : "month";

  let range = monthRange();
  if (period === "today") {
    range = todayRange();
  } else if (period === "week") {
    range = weekRange();
  } else if (period === "custom") {
    const from = typeof params.from === "string" && isValidISODate(params.from)
      ? params.from
      : null;
    const to = typeof params.to === "string" && isValidISODate(params.to)
      ? params.to
      : null;
    if (from && to && from <= to) {
      range = { from, to };
    } else {
      range = monthRange();
    }
  }

  // Start the static catalog immediately. getDashboardData() shares the same
  // request-memoized auth promise with the page and dashboard layout.
  const [auth, data, categories, lineConnected] = await Promise.all([
    getAuthContext(),
    getDashboardData(range),
    listCategories(),
    getLineConnected(),
  ]);

  return (
    <DashboardView
      data={data}
      categories={categories}
      period={period}
      range={range}
      displayName={auth?.displayName ?? ""}
      lineConnected={lineConnected}
    />
  );
}
