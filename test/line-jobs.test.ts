import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

vi.mock("@/lib/line-bot", () => ({
  handleLineMessage: vi.fn(),
}));

vi.mock("@/lib/line", () => ({
  lineRetryKey: vi.fn(),
  pushToUser: vi.fn(),
  replyToUser: vi.fn(),
}));

import { processDueLineJobs } from "@/lib/line-jobs";

afterEach(() => {
  vi.clearAllMocks();
});

describe("processDueLineJobs", () => {
  it("claims only the next job before beginning sequential processing", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    await processDueLineJobs(3);

    expect(mocks.rpc).toHaveBeenCalledWith("claim_due_line_jobs", {
      p_limit: 1,
    });
  });
});
