import { describe, expect, it, vi, beforeEach } from "vitest";

import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";
import { createMutationGuardedHandler } from "../../src/runtime/mutation-guard.js";

interface Input {
  id: number;
  value: string;
  confirmation_token?: string;
}

describe("createMutationGuardedHandler", () => {
  beforeEach(() => {
    _resetConfirmationTokens();
  });

  it("returns a plan and token without applying the mutation", async () => {
    const apply = vi.fn();
    const handler = createMutationGuardedHandler<
      Input,
      { current: string },
      { value: string }
    >({
      toolName: "test_tool",
      loadCurrent: async () => "before",
      buildPlan: (input, current) => ({ current, value: input.value }),
      apply,
      renderPlanMarkdown: (_input, _plan, token) => `Use ${token}`,
    });

    const result = await handler({ id: 1, value: "after" });

    expect(result.status).toBe("plan");
    expect(result).toMatchObject({
      current: "before",
      value: "after",
    });
    expect(result.confirmation_token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies only when the token matches the current state and parameters", async () => {
    const apply = vi.fn(
      async (_input: Input, plan: { current: string; value: string }) => ({
        applied_value: plan.value,
      }),
    );
    const handler = createMutationGuardedHandler<
      Input,
      { current: string; value: string },
      { applied_value: string }
    >({
      toolName: "test_tool",
      loadCurrent: async () => "before",
      buildPlan: (input, current) => ({ current, value: input.value }),
      apply,
      renderPlanMarkdown: (_input, _plan, token) => `Use ${token}`,
    });

    const plan = await handler({ id: 1, value: "after" });
    const applied = await handler({
      id: 1,
      value: "after",
      confirmation_token: plan.confirmation_token,
    });

    expect(applied).toEqual({
      status: "applied",
      applied_value: "after",
    });
    expect(apply).toHaveBeenCalledOnce();
  });

  it("rejects apply when the prefetched current state changed after planning", async () => {
    const currentStates = ["before", "changed"];
    const apply = vi.fn();
    const handler = createMutationGuardedHandler<
      Input,
      { current: string },
      { ok: true }
    >({
      toolName: "test_tool",
      loadCurrent: async () => currentStates.shift() ?? "changed",
      buildPlan: (_input, current) => ({ current }),
      apply,
      renderPlanMarkdown: (_input, _plan, token) => `Use ${token}`,
    });

    const plan = await handler({ id: 1, value: "after" });

    await expect(
      handler({
        id: 1,
        value: "after",
        confirmation_token: plan.confirmation_token,
      }),
    ).rejects.toThrow(/invalid, expired, stale/i);
    expect(apply).not.toHaveBeenCalled();
  });
});
