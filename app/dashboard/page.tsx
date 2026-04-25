import { DashboardView } from "@/components/dashboard/dashboard-view";
import { PrivateDashboardMessage } from "@/components/dashboard/private-dashboard-message";
import {
  getDefaultLineUserId,
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
    lineUserId?: string | string[];
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

  const summary = await getDashboardSummary(lineUserId);

  return <DashboardView summary={summary} />;
}
