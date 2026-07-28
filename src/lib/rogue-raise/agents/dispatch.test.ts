import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runAgentMock, startMock } = vi.hoisted(() => ({
  runAgentMock: vi.fn(),
  startMock: vi.fn(),
}));

vi.mock("./execute", () => ({ runAgent: runAgentMock }));
vi.mock("workflow/api", () => ({ start: startMock }));
vi.mock("./workflow", () => ({ agentRunWorkflow: () => Promise.resolve() }));

import { dispatchAgentRun, dispatchMode } from "./dispatch";

const INPUT = { eventId: "e1", type: "context_research_repo" as const };
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  runAgentMock.mockReset().mockResolvedValue({ ok: true, runId: "r1", assetIds: [] });
  startMock.mockReset().mockResolvedValue({ runId: "wf_1" });
  delete process.env.RR_WORKFLOWS_ENABLED;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("dispatchMode", () => {
  it("is inline unless durability is explicitly enabled", () => {
    expect(dispatchMode()).toBe("inline");
    process.env.RR_WORKFLOWS_ENABLED = "false";
    expect(dispatchMode()).toBe("inline");
    process.env.RR_WORKFLOWS_ENABLED = "1";
    // Only the exact string — the workflow runtime either exists or it doesn't.
    expect(dispatchMode()).toBe("inline");
  });

  it("is durable when enabled", () => {
    process.env.RR_WORKFLOWS_ENABLED = "true";
    expect(dispatchMode()).toBe("durable");
  });
});

describe("dispatchAgentRun", () => {
  it("runs inline by default, returning the outcome", async () => {
    const result = await dispatchAgentRun(INPUT);
    expect(result.mode).toBe("inline");
    expect(result.outcome).toMatchObject({ ok: true });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("starts a durable run when enabled, WITHOUT waiting for it", async () => {
    process.env.RR_WORKFLOWS_ENABLED = "true";
    const result = await dispatchAgentRun(INPUT);
    expect(result.mode).toBe("durable");
    expect(result.runId).toBe("wf_1");
    // The point of durability: the request doesn't hold the agent open.
    expect(result.outcome).toBeUndefined();
    expect(runAgentMock).not.toHaveBeenCalled();
  });

  it("falls back to inline when the workflow runtime is unreachable", async () => {
    process.env.RR_WORKFLOWS_ENABLED = "true";
    startMock.mockRejectedValue(new Error("no workflow runtime"));

    const result = await dispatchAgentRun(INPUT);
    // Better a run bounded by the request timeout — where it was before — than
    // telling staff their agent didn't start.
    expect(result.mode).toBe("inline");
    expect(result.outcome).toMatchObject({ ok: true });
    expect(result.fellBackBecause).toContain("no workflow runtime");
    expect(runAgentMock).toHaveBeenCalledOnce();
  });

  it("passes the agent input through unchanged", async () => {
    const input = { ...INPUT, additionalInstructions: "Be terse." };
    await dispatchAgentRun(input);
    expect(runAgentMock).toHaveBeenCalledWith(input);
  });

  it("surfaces a failed inline run rather than swallowing it", async () => {
    runAgentMock.mockResolvedValue({ ok: false, runId: "r1", reason: "boom" });
    const result = await dispatchAgentRun(INPUT);
    expect(result.outcome).toMatchObject({ ok: false, reason: "boom" });
  });
});
