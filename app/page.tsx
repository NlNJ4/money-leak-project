import { DashboardView } from "@/components/dashboard/dashboard-view";
import {
  DEMO_LINE_USER_ID,
  getDashboardSummary,
} from "@/lib/expense-service";
import { connection } from "next/server";

export default async function Home() {
  await connection();

  const summary = await getDashboardSummary(DEMO_LINE_USER_ID);

  return <DashboardView summary={summary} />;
}
