import {
  consumeConfirmationToken,
  mintConfirmationToken,
} from "./confirmation-store.js";

type ConfirmableInput = {
  confirmation_token?: string | undefined;
};

type PlanResult<TPlan extends Record<string, unknown>> = TPlan & {
  status: "plan";
  confirmation_token: string;
  token_expires_at: string;
  next_step_markdown: string;
};

type AppliedResult<TApplied extends Record<string, unknown>> = TApplied & {
  status: "applied";
};

export interface MutationGuardConfig<
  TInput extends ConfirmableInput,
  TCurrent,
  TPlan extends Record<string, unknown>,
  TApplied extends Record<string, unknown>,
> {
  toolName: string;
  loadCurrent: (input: TInput) => Promise<TCurrent>;
  buildPlan: (input: TInput, current: TCurrent) => TPlan;
  apply: (input: TInput, plan: TPlan, current: TCurrent) => Promise<TApplied>;
  renderPlanMarkdown: (input: TInput, plan: TPlan, token: string) => string;
  fingerprintPayload?: (
    input: TInput,
    current: TCurrent,
    plan: TPlan,
  ) => unknown;
}

export function createMutationGuardedHandler<
  TInput extends ConfirmableInput,
  TCurrent,
  TPlan extends Record<string, unknown>,
  TApplied extends Record<string, unknown>,
>(
  config: MutationGuardConfig<TInput, TCurrent, TPlan, TApplied>,
): (input: TInput) => Promise<PlanResult<TPlan> | AppliedResult<TApplied>> {
  return async (input: TInput) => {
    const current = await config.loadCurrent(input);
    const plan = config.buildPlan(input, current);
    const fingerprint = stringifyStable(
      config.fingerprintPayload?.(input, current, plan) ?? {
        tool: config.toolName,
        input: stripConfirmationToken(input),
        current,
        plan,
      },
    );

    if (!input.confirmation_token) {
      const { token, expiresAt } = mintConfirmationToken(fingerprint);
      return {
        status: "plan",
        ...plan,
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: config.renderPlanMarkdown(input, plan, token),
      };
    }

    if (!consumeConfirmationToken(input.confirmation_token, fingerprint)) {
      throw new Error(
        "Confirmation token is invalid, expired, stale, or doesn't match the parameters.",
      );
    }

    return {
      status: "applied",
      ...(await config.apply(input, plan, current)),
    };
  };
}

function stripConfirmationToken(
  input: ConfirmableInput,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key !== "confirmation_token" && value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function stringifyStable(value: unknown): string {
  return JSON.stringify(sortForStringify(value));
}

function sortForStringify(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortForStringify(item));
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entryValue]) => [key, sortForStringify(entryValue)]);
    return Object.fromEntries(entries);
  }
  return value;
}
