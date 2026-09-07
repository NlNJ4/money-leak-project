import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/supabase/server";
import {
  getAiStatus,
  listDeadJobs,
  queueHealth,
} from "@/lib/observability";
import { retryDeadJobs } from "@/lib/line-jobs";
import { OpsView } from "@/components/ops/ops-view";

// Operational dashboard: queue health, dead letters, worker heartbeat, AI
// usage. Single-user deployment — any signed-in user is the operator.
export default async function OpsPage() {
  const auth = await getAuthContext();
  if (!auth) {
    redirect("/login");
  }

  const [health, ai, dead] = await Promise.all([
    queueHealth(),
    getAiStatus(),
    listDeadJobs(),
  ]);

  const circuitOpen = ai.circuitOpen;

  async function retryDead(): Promise<number> {
    "use server";
    const retried = await retryDeadJobs();
    return retried.length;
  }

  return (
    <OpsView
      health={health}
      ai={ai}
      circuitOpen={circuitOpen}
      dead={dead}
      retryDeadAction={retryDead}
    />
  );
}
