import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PrivateDashboardMessage } from "@/components/dashboard/private-dashboard-message";
import { normalizeDashboardExpenseFilters } from "@/lib/dashboard-filters";
import {
  getDefaultLineUserId,
  getDashboardExpenseResult,
  getDashboardSummary,
} from "@/lib/expense-service";
import {
  getSingleSearchParam,
  hasLineUserDataAccess,
  normalizeLineUserId,
} from "@/lib/security";
import { connection } from "next/server";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    accessToken?: string | string[];
    category?: string | string[];
    limit?: string | string[];
    lineUserId?: string | string[];
    q?: string | string[];
    range?: string | string[];
  }>;
}) {
  await connection();

  const params = await searchParams;
  const defaultLineUserId = getDefaultLineUserId();
  const lineUserIdParam = getSingleSearchParam(params.lineUserId);
  const accessToken = getSingleSearchParam(params.accessToken);

  if (lineUserIdParam === null || accessToken === null) {
    return <PrivateDashboardMessage />;
  }

  const lineUserId =
    lineUserIdParam === undefined
      ? defaultLineUserId
      : normalizeLineUserId(lineUserIdParam, "");

  if (!lineUserId) return <PrivateDashboardMessage />;

  if (
    !hasLineUserDataAccess({
      lineUserId,
      accessToken,
    })
  ) {
    return <PrivateDashboardMessage />;
  }

  const expenseFilters = normalizeDashboardExpenseFilters(params);
  const [summary, expenseResult] = await Promise.all([
    getDashboardSummary(lineUserId),
    getDashboardExpenseResult(lineUserId, expenseFilters),
  ]);

  return (
    <DashboardView
      accessToken={accessToken}
      dashboardAction="/dashboard"
      expenseFilters={expenseFilters}
      expenseResult={expenseResult}
      summary={summary}
    />
  );
}
