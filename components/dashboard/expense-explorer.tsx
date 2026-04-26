import { ExpenseList } from "@/components/dashboard/expense-list";
import { categoryConfig, categoryOrder } from "@/lib/categories";
import {
  DASHBOARD_EXPENSE_PAGE_SIZE,
  type DashboardExpenseFilters,
  type DashboardExpenseResult,
} from "@/lib/dashboard-filters";
import { formatBaht } from "@/lib/format";

function buildExpenseExplorerHref({
  accessToken,
  action,
  filters,
  lineUserId,
  limit,
}: {
  accessToken?: string | null;
  action: string;
  filters: DashboardExpenseFilters;
  lineUserId: string;
  limit?: number;
}) {
  const params = new URLSearchParams({
    lineUserId,
    range: filters.range,
  });

  if (accessToken) params.set("accessToken", accessToken);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.query) params.set("q", filters.query);
  if (limit && limit !== DASHBOARD_EXPENSE_PAGE_SIZE) {
    params.set("limit", String(limit));
  }

  return `${action}?${params.toString()}`;
}

function buildResetHref({
  accessToken,
  action,
  lineUserId,
}: {
  accessToken?: string | null;
  action: string;
  lineUserId: string;
}) {
  const params = new URLSearchParams({ lineUserId });

  if (accessToken) params.set("accessToken", accessToken);

  return `${action}?${params.toString()}`;
}

export function ExpenseExplorer({
  accessToken,
  action,
  filters,
  lineUserId,
  result,
}: {
  accessToken?: string | null;
  action: string;
  filters: DashboardExpenseFilters;
  lineUserId: string;
  result: DashboardExpenseResult;
}) {
  const showMoreHref = buildExpenseExplorerHref({
    accessToken,
    action,
    filters,
    lineUserId,
    limit: result.nextLimit,
  });
  const resetHref = buildResetHref({ accessToken, action, lineUserId });

  return (
    <div className="grid gap-4">
      <form
        action={action}
        className="grid gap-3 rounded-md border border-zinc-100 bg-zinc-50 p-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(10rem,0.7fr)_minmax(10rem,0.7fr)_auto] lg:items-end"
        method="get"
      >
        <input name="lineUserId" type="hidden" value={lineUserId} />
        {accessToken ? (
          <input name="accessToken" type="hidden" value={accessToken} />
        ) : null}
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          ค้นหา
          <input
            className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            defaultValue={filters.query}
            name="q"
            placeholder="ร้านหรือรายการ"
          />
        </label>
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          ช่วงเวลา
          <select
            className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            defaultValue={filters.range}
            name="range"
          >
            <option value="7d">7 วันล่าสุด</option>
            <option value="30d">30 วันล่าสุด</option>
            <option value="month">เดือนนี้</option>
            <option value="90d">90 วันล่าสุด</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium text-zinc-700">
          หมวด
          <select
            className="min-h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-950 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            defaultValue={filters.category}
            name="category"
          >
            <option value="all">ทุกหมวด</option>
            {categoryOrder.map((category) => (
              <option key={category} value={category}>
                {categoryConfig[category].label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="min-h-10 rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-zinc-900 focus:ring-offset-2"
            type="submit"
          >
            กรอง
          </button>
          <a
            className="inline-flex min-h-10 items-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
            href={resetHref}
          >
            ล้าง
          </a>
        </div>
      </form>

      <div className="flex flex-col gap-1 rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm text-emerald-950 sm:flex-row sm:items-center sm:justify-between">
        <p className="font-medium">
          พบ {result.totalCount} รายการ รวม {formatBaht(result.totalBaht)}
        </p>
        <p className="text-xs text-emerald-800">
          {result.rangeLabel} · {result.categoryLabel}
          {filters.query ? ` · "${filters.query}"` : ""}
        </p>
      </div>

      <ExpenseList
        accessToken={accessToken}
        emptyMessage="ไม่พบรายการที่ตรงกับตัวกรอง"
        expenses={result.expenses}
        lineUserId={lineUserId}
      />

      {result.hasMore ? (
        <a
          className="inline-flex min-h-10 w-full items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400 focus:ring-offset-2"
          href={showMoreHref}
        >
          แสดงเพิ่มอีก {DASHBOARD_EXPENSE_PAGE_SIZE} รายการ
        </a>
      ) : result.totalCount > 0 ? (
        <p className="text-center text-xs font-medium text-zinc-500">
          แสดงครบแล้ว {result.visibleCount} รายการ
        </p>
      ) : null}
    </div>
  );
}
