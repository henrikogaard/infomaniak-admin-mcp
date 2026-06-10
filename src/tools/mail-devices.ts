import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const MailDeviceScopeInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z.string().min(1).optional(),
  scope: z.enum(["mailbox", "service"]).default("mailbox"),
});

const MailDeviceReadInput = MailDeviceScopeInput.extend({
  action: z.enum(["list_user", "inventory"]),
  user_id: z.number().int().positive().optional(),
});

const MailDeviceWriteInput = MailDeviceScopeInput.extend({
  action: z.enum(["delete_user_device", "delete_user_devices"]),
  user_id: z.number().int().positive().optional(),
  device_access: z
    .union([z.string().min(1), z.number().int().positive()])
    .optional(),
  confirmation_token: z.string().uuid().optional(),
});

const ReadOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string().optional(),
  scope: z.enum(["mailbox", "service"]),
  action: z.enum(["list_user", "inventory"]),
  result: z.unknown(),
});

const ConfirmedOutput = z.union([
  z.object({
    status: z.literal("plan"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string().optional(),
    scope: z.enum(["mailbox", "service"]),
    action: z.enum(["delete_user_device", "delete_user_devices"]),
    current: z.unknown(),
    mutation: z.object({
      method: z.literal("DELETE"),
      path: z.string(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string().optional(),
    scope: z.enum(["mailbox", "service"]),
    action: z.enum(["delete_user_device", "delete_user_devices"]),
    result: z.unknown().optional(),
    message: z.string(),
  }),
]);

export const getMailDevicesTool = defineTool({
  name: "infomaniak_get_mail_device_access",
  description:
    "Inspect mailbox device/session access for a selected mailbox user, or list mailbox/service device inventories for cleanup planning.",
  inputSchema: MailDeviceReadInput,
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
      resolveMailDeviceReadPath(input),
    );
    recordHistory({
      tool: "infomaniak_get_mail_device_access",
      kind: "mail_admin",
      summary: `Read device access for ${describeMailDeviceTarget(input)}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        scope: resolvedScope(input),
        action: input.action,
        ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      scope: resolvedScope(input),
      action: input.action,
      result,
    };
  },
});

export const manageMailDevicesTool = defineMailMutationTool({
  name: "infomaniak_manage_mail_device_access",
  description:
    "Delete a specific device access, or revoke all device sessions for a mailbox or service user. Uses two-phase confirmation and current-state guards.",
  inputSchema: MailDeviceWriteInput,
  loadCurrent: async (input) => readMailDeviceCurrent(input),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
    scope: resolvedScope(input),
    action: input.action,
    current,
    mutation: buildMailDeviceMutation(input),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const mutation = buildMailDeviceMutation(input);
    const result = await client.request<unknown>(
      mutation.method,
      mutation.path,
    );
    recordHistory({
      tool: "infomaniak_manage_mail_device_access",
      kind: "mail_admin",
      summary: `${input.action} for ${describeMailDeviceTarget(input)}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        scope: resolvedScope(input),
        action: input.action,
        ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
        ...(input.device_access !== undefined
          ? { device_access: input.device_access }
          : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      scope: resolvedScope(input),
      action: input.action,
      result,
      message: `✅ Mail device access ${input.action}.`,
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

async function readMailDeviceCurrent(
  input: z.infer<typeof MailDeviceWriteInput>,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>("GET", resolveMailDeviceReadPath(input));
}

function buildMailDeviceMutation(input: z.infer<typeof MailDeviceWriteInput>): {
  method: "DELETE";
  path: string;
} {
  const scope = resolvedScope(input);
  return {
    method: "DELETE",
    path:
      scope === "mailbox"
        ? input.action === "delete_user_devices"
          ? `${mailboxBase(input, "/accesses/devices/users")}/${encodeURIComponent(requireUserId(input))}`
          : `${mailboxBase(input, "/accesses/devices")}/${encodeURIComponent(requireDeviceId(input))}`
        : input.action === "delete_user_devices"
          ? `/1/mail_hostings/${input.mail_hosting_id}/accesses/devices/users/${encodeURIComponent(requireUserId(input))}`
          : `/1/mail_hostings/accesses/devices/${encodeURIComponent(requireDeviceId(input))}`,
  };
}

function resolveMailDeviceReadPath(
  input:
    | z.infer<typeof MailDeviceReadInput>
    | z.infer<typeof MailDeviceWriteInput>,
): string {
  const scope = resolvedScope(input);
  if (scope === "mailbox") {
    if (input.action === "inventory") {
      return mailboxBase(input, "/accesses/devices");
    }
    return `${mailboxBase(input, "/accesses/devices/users")}/${encodeURIComponent(requireUserId(input))}`;
  }
  if (input.action === "inventory") {
    return `/1/mail_hostings/accesses/devices`;
  }
  return `/1/mail_hostings/${input.mail_hosting_id}/accesses/devices/users/${encodeURIComponent(requireUserId(input))}`;
}

function mailboxBase(
  input: { mail_hosting_id: number; mailbox_name?: string | undefined },
  suffix: string,
): string {
  return `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(requireMailboxName(input))}${suffix}`;
}

function requireMailboxName(input: {
  mailbox_name?: string | undefined;
}): string {
  if (!input.mailbox_name) {
    throw new Error(
      "mailbox_name is required for mailbox-scoped device access actions",
    );
  }
  return input.mailbox_name;
}

function requireUserId(input: { user_id?: number | undefined }): number {
  if (input.user_id === undefined) {
    throw new Error("user_id is required for this device access action");
  }
  return input.user_id;
}

function requireDeviceId(input: {
  device_access?: string | number | undefined;
}): string | number {
  if (
    input.device_access === undefined ||
    input.device_access === null ||
    input.device_access === ""
  ) {
    throw new Error("device_access is required for this device access action");
  }
  return input.device_access;
}

function describeMailDeviceTarget(input: {
  scope: "mailbox" | "service";
  mailbox_name?: string | undefined;
  user_id?: number | undefined;
}): string {
  if (resolvedScope(input) === "mailbox") {
    return input.mailbox_name ? `${input.mailbox_name} mailbox` : "mailbox";
  }
  return input.user_id !== undefined
    ? `service user ${input.user_id}`
    : "service";
}

function resolvedScope(input: {
  scope?: "mailbox" | "service" | undefined;
}): "mailbox" | "service" {
  return input.scope ?? "mailbox";
}

function renderPlanMarkdown(
  input: z.infer<typeof MailDeviceWriteInput>,
  plan: Record<string, unknown>,
  token: string,
): string {
  const mutation = plan["mutation"] as Record<string, unknown> | undefined;
  return [
    `## Plan - manage mail device access`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: ${input.mailbox_name ?? "n/a"}`,
    `- **Scope**: ${input.scope}`,
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
