import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  DEMO_LINE_USER_ID,
  getDashboardSummary,
} from "@/lib/expense-service";
import { connection } from "next/server";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ lineUserId?: string }>;
}) {
  await connection();

  const params = await searchParams;
  const lineUserId = params.lineUserId ?? DEMO_LINE_USER_ID;
  const summary = getDashboardSummary(lineUserId);

  return <DashboardView summary={summary} />;
}
