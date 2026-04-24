import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  getDefaultLineUserId,
  getDashboardSummary,
} from "@/lib/expense-service";
import { connection } from "next/server";

export default async function Home() {
  await connection();

  const summary = await getDashboardSummary(getDefaultLineUserId());

  return <DashboardView summary={summary} />;
}
