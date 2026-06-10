import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const NewsletterInput = z.object({
  domain: z.string().min(1).describe("Newsletter domain, e.g. example.com."),
});

const NewsletterReadInput = NewsletterInput.extend({
  action: z.enum([
    "groups",
    "group",
    "group_subscribers",
    "subscribers",
    "subscriber",
    "count_status",
  ]),
  group: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  subscriber: z
    .union([z.string().min(1), z.number().int().positive()])
    .optional(),
});

const NewsletterWriteInput = NewsletterInput.extend({
  action: z.enum([
    "create_group",
    "update_group",
    "delete_group",
    "create_subscriber",
    "update_subscriber",
    "delete_subscriber",
    "delete_subscribers",
    "forget_subscriber",
    "unsubscribe_subscribers",
    "assign_subscribers",
    "unassign_subscribers",
    "group_assign_subscribers",
    "group_unassign_subscribers",
  ]),
  group: z.union([z.string().min(1), z.number().int().positive()]).optional(),
  subscriber: z
    .union([z.string().min(1), z.number().int().positive()])
    .optional(),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body to send to Infomaniak for this operation."),
  confirmation_token: z.string().uuid().optional(),
});

const ReadOutput = z.object({
  domain: z.string(),
  action: z.enum([
    "groups",
    "group",
    "group_subscribers",
    "subscribers",
    "subscriber",
    "count_status",
  ]),
  result: z.unknown(),
});

const ConfirmedOutput = z.union([
  z.object({
    status: z.literal("plan"),
    domain: z.string(),
    action: z.enum([
      "create_group",
      "update_group",
      "delete_group",
      "create_subscriber",
      "update_subscriber",
      "delete_subscriber",
      "delete_subscribers",
      "forget_subscriber",
      "unsubscribe_subscribers",
      "assign_subscribers",
      "unassign_subscribers",
      "group_assign_subscribers",
      "group_unassign_subscribers",
    ]),
    current: z.unknown(),
    mutation: z.object({
      method: z.enum(["POST", "PUT", "DELETE"]),
      path: z.string(),
      body: z.record(z.unknown()).optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    domain: z.string(),
    action: z.enum([
      "create_group",
      "update_group",
      "delete_group",
      "create_subscriber",
      "update_subscriber",
      "delete_subscriber",
      "delete_subscribers",
      "forget_subscriber",
      "unsubscribe_subscribers",
      "assign_subscribers",
      "unassign_subscribers",
      "group_assign_subscribers",
      "group_unassign_subscribers",
    ]),
    result: z.unknown().optional(),
    message: z.string(),
  }),
]);

export const getNewsletterAdminTool = defineTool({
  name: "infomaniak_get_newsletter_admin",
  description:
    "Inspect newsletter groups, group subscribers, subscriber inventory, and count-status summaries for a domain. Read-only admin inventory for list governance.",
  inputSchema: NewsletterReadInput,
  outputSchema: ReadOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "GET",
      resolveNewsletterReadPath(input),
    );
    recordHistory({
      tool: "infomaniak_get_newsletter_admin",
      kind: "mail_admin",
      summary: `Read newsletter ${input.action} for ${input.domain}`,
      payload: {
        domain: input.domain,
        action: input.action,
        ...(input.group !== undefined ? { group: input.group } : {}),
        ...(input.subscriber !== undefined
          ? { subscriber: input.subscriber }
          : {}),
      },
    });
    return {
      domain: input.domain,
      action: input.action,
      result,
    };
  },
});

export const manageNewsletterAdminTool = defineMailMutationTool({
  name: "infomaniak_manage_newsletter_admin",
  description:
    "Create, update, delete, assign, unassign, or forget newsletter groups and subscribers. Uses two-phase confirmation and rechecks the current list before apply.",
  inputSchema: NewsletterWriteInput,
  loadCurrent: async (input) => readNewsletterCurrent(input),
  buildPlan: (input, current) => ({
    domain: input.domain,
    action: input.action,
    current,
    mutation: buildNewsletterMutation(input),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const mutation = buildNewsletterMutation(input);
    const result = await client.request<unknown>(
      mutation.method,
      mutation.path,
      {
        body: mutation.body,
      },
    );
    recordHistory({
      tool: "infomaniak_manage_newsletter_admin",
      kind: "mail_admin",
      summary: `${input.action} newsletter data for ${input.domain}`,
      payload: {
        domain: input.domain,
        action: input.action,
        ...(input.group !== undefined ? { group: input.group } : {}),
        ...(input.subscriber !== undefined
          ? { subscriber: input.subscriber }
          : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      domain: input.domain,
      action: input.action,
      result,
      message: `✅ Newsletter ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderPlanMarkdown(input, plan, token),
});

function defineMailMutationTool<
  TInput extends z.ZodTypeAny,
  TCurrent,
  TPlan extends Record<string, unknown>,
  TApplied extends Record<string, unknown>,
>(config: {
  name: string;
  description: string;
  inputSchema: TInput;
  loadCurrent: (input: z.infer<TInput>) => Promise<TCurrent>;
  buildPlan: (input: z.infer<TInput>, current: TCurrent) => TPlan;
  apply: (
    input: z.infer<TInput>,
    plan: TPlan,
    current: TCurrent,
  ) => Promise<TApplied>;
  renderPlanMarkdown: (
    input: z.infer<TInput>,
    plan: TPlan,
    token: string,
  ) => string;
}): ReturnType<typeof defineTool> {
  return defineTool({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: ConfirmedOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    capability: {
      scope: "admin",
      risk: "destructive",
      confirmationRequired: true,
    },
    handler: createMutationGuardedHandler({
      toolName: config.name,
      loadCurrent: config.loadCurrent,
      buildPlan: config.buildPlan,
      apply: config.apply,
      renderPlanMarkdown: config.renderPlanMarkdown,
    }),
  });
}

async function readNewsletterCurrent(
  input: z.infer<typeof NewsletterWriteInput>,
): Promise<unknown> {
  const client = new PublicApiClient();
  switch (input.action) {
    case "create_group":
    case "delete_group":
      return await client.request<unknown>(
        "GET",
        `/1/newsletters/${encodeURIComponent(input.domain)}/groups`,
      );
    case "update_group":
      return await client.request<unknown>(
        "GET",
        `/1/newsletters/${encodeURIComponent(input.domain)}/groups/${encodeURIComponent(requireGroupId(input))}`,
      );
    case "create_subscriber":
    case "delete_subscribers":
    case "unsubscribe_subscribers":
    case "assign_subscribers":
    case "unassign_subscribers":
      return await client.request<unknown>(
        "GET",
        `/1/newsletters/${encodeURIComponent(input.domain)}/subscribers`,
      );
    case "update_subscriber":
    case "delete_subscriber":
    case "forget_subscriber":
      return await client.request<unknown>(
        "GET",
        `/1/newsletters/${encodeURIComponent(input.domain)}/subscribers/${encodeURIComponent(requireSubscriberId(input))}`,
      );
    case "group_assign_subscribers":
    case "group_unassign_subscribers":
      return await client.request<unknown>(
        "GET",
        `/1/newsletters/${encodeURIComponent(input.domain)}/groups/${encodeURIComponent(requireGroupId(input))}/subscribers`,
      );
  }
}

function buildNewsletterMutation(input: z.infer<typeof NewsletterWriteInput>): {
  method: "POST" | "PUT" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
} {
  const domainPath = `/1/newsletters/${encodeURIComponent(input.domain)}`;
  switch (input.action) {
    case "create_group":
      return {
        method: "POST",
        path: `${domainPath}/groups`,
        body: input.payload ?? {},
      };
    case "update_group":
      return {
        method: "PUT",
        path: `${domainPath}/groups/${encodeURIComponent(requireGroupId(input))}`,
        body: input.payload ?? {},
      };
    case "delete_group":
      return {
        method: "DELETE",
        path: `${domainPath}/groups/${encodeURIComponent(requireGroupId(input))}`,
      };
    case "create_subscriber":
      return {
        method: "POST",
        path: `${domainPath}/subscribers`,
        body: input.payload ?? {},
      };
    case "update_subscriber":
      return {
        method: "PUT",
        path: `${domainPath}/subscribers/${encodeURIComponent(requireSubscriberId(input))}`,
        body: input.payload ?? {},
      };
    case "delete_subscriber":
      return {
        method: "DELETE",
        path: `${domainPath}/subscribers/${encodeURIComponent(requireSubscriberId(input))}`,
      };
    case "delete_subscribers":
      return {
        method: "DELETE",
        path: `${domainPath}/subscribers`,
        body: input.payload ?? {},
      };
    case "forget_subscriber":
      return {
        method: "DELETE",
        path: `${domainPath}/subscribers/${encodeURIComponent(requireSubscriberId(input))}/forget`,
      };
    case "unsubscribe_subscribers":
      return {
        method: "PUT",
        path: `${domainPath}/subscribers/unsubscribe`,
        body: input.payload ?? {},
      };
    case "assign_subscribers":
      return {
        method: "PUT",
        path: `${domainPath}/subscribers/assign`,
        body: input.payload ?? {},
      };
    case "unassign_subscribers":
      return {
        method: "PUT",
        path: `${domainPath}/subscribers/unassign`,
        body: input.payload ?? {},
      };
    case "group_assign_subscribers":
      return {
        method: "POST",
        path: `${domainPath}/groups/${encodeURIComponent(requireGroupId(input))}/subscribers/assign`,
        body: input.payload ?? {},
      };
    case "group_unassign_subscribers":
      return {
        method: "POST",
        path: `${domainPath}/groups/${encodeURIComponent(requireGroupId(input))}/subscribers/unassign`,
        body: input.payload ?? {},
      };
  }
}

function resolveNewsletterReadPath(
  input: z.infer<typeof NewsletterReadInput>,
): string {
  const domainPath = `/1/newsletters/${encodeURIComponent(input.domain)}`;
  switch (input.action) {
    case "groups":
      return `${domainPath}/groups`;
    case "group":
      return `${domainPath}/groups/${encodeURIComponent(requireGroupId(input))}`;
    case "group_subscribers":
      return `${domainPath}/groups/${encodeURIComponent(requireGroupId(input))}/subscribers`;
    case "subscribers":
      return `${domainPath}/subscribers`;
    case "subscriber":
      return `${domainPath}/subscribers/${encodeURIComponent(requireSubscriberId(input))}`;
    case "count_status":
      return `${domainPath}/subscribers/count_status`;
  }
}

function requireGroupId(input: {
  group?: string | number | undefined;
}): string | number {
  if (input.group === undefined || input.group === null || input.group === "") {
    throw new Error("group is required for this newsletter action");
  }
  return input.group;
}

function requireSubscriberId(input: {
  subscriber?: string | number | undefined;
}): string | number {
  if (
    input.subscriber === undefined ||
    input.subscriber === null ||
    input.subscriber === ""
  ) {
    throw new Error("subscriber is required for this newsletter action");
  }
  return input.subscriber;
}

function renderPlanMarkdown(
  input: z.infer<typeof NewsletterWriteInput>,
  plan: Record<string, unknown>,
  token: string,
): string {
  const mutation = plan["mutation"] as Record<string, unknown> | undefined;
  return [
    `## Plan - manage newsletter data`,
    ``,
    `- **Domain**: ${input.domain}`,
    `- **Action**: ${input.action}`,
    `- **Endpoint**: \`${String(mutation?.["path"] ?? "")}\``,
    ``,
    `### Current state`,
    `\`\`\`json`,
    `${JSON.stringify(plan["current"], null, 2)}`,
    `\`\`\``,
    ``,
    `### Mutation`,
    `\`\`\`json`,
    `${JSON.stringify(plan["mutation"], null, 2)}`,
    `\`\`\``,
    ``,
    `### Next step`,
    `Re-call with \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}
