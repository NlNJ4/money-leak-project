import "./app-env";
import { afterAll, describe, expect, it } from "vitest";
import { serviceClient } from "./env";
import { wipeLocalData } from "./helpers";
import {
  metricsRange,
  queueHealth,
  recordMetrics,
} from "@/lib/observability";

afterAll(wipeLocalData);

describe("observability", () => {
  it("counts metrics atomically per day and key", async () => {
    // A test-only key: other suites record real keys through the worker,
    // so assertions must not share their counter space.
    await recordMetrics(["obs_test_a", "obs_test_b"]);
    await recordMetrics(["obs_test_a"]);
    await recordMetrics(["obs_test_a"]);

    const today = new Date().toISOString().slice(0, 10);
    const { data } = await serviceClient()
      .from("line_metrics")
      .select("count")
      .eq("day", today)
      .eq("key", "obs_test_a")
      .single();
    expect(Number(data?.count)).toBe(3);
  });

  it("reports queue health with depth, oldest age, and heartbeat", async () => {
    await serviceClient().rpc("touch_heartbeat");
    await serviceClient().from("line_jobs").insert({
      id: "obs-pending-fixture",
      line_user_id: "U-obs",
      reply_token: "t",
      text: "x",
    });

    const health = await queueHealth();
    expect(health.depth["pending"]).toBeGreaterThanOrEqual(1);
    expect(health.oldestPendingSeconds).not.toBeNull();
    expect(health.oldestPendingSeconds!).toBeLessThanOrEqual(60);
    expect(health.heartbeatAgeSeconds).not.toBeNull();
    expect(health.heartbeatAgeSeconds!).toBeLessThanOrEqual(10);

    await serviceClient().from("line_jobs").delete().eq("id", "obs-pending-fixture");
  });

  it("returns a metric range without any user content", async () => {
    const metrics = await metricsRange(7);
    for (const row of metrics) {
      expect(row.key).toMatch(/^[a-z0-9_:]+$/);
    }
  });
});
