import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  getDefaultLineUserId,
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
  const lineUserId = params.lineUserId ?? getDefaultLineUserId();
  const summary = await getDashboardSummary(lineUserId);

  return <DashboardView summary={summary} />;
}
