import { z } from "zod";

import { PublicApiClient, type QueryValue } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const MailboxInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z.string().min(1),
});

const EmailImportQuerySchema = z
  .object({
    search: z.string().min(1).optional(),
    return: z.literal("total").optional(),
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().max(500).optional(),
    order_by: z.enum(["source", "started_at", "finished_at", "state"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
  })
  .partial();

const GenericMutationOutput = z
  .union([
    z
      .object({
        status: z.literal("plan"),
        confirmation_token: z.string(),
        token_expires_at: z.string(),
        next_step_markdown: z.string(),
      })
      .passthrough(),
    z
      .object({ status: z.literal("applied"), message: z.string() })
      .passthrough(),
  ])
  .describe("Two-phase confirmation result.");

export const listEmailImportsTool = defineTool({
  name: "infomaniak_list_email_imports",
  description: "List email-import jobs and their state for a mailbox.",
  inputSchema: MailboxInput.extend({ query: EmailImportQuerySchema.optional() }),
  outputSchema: z.object({
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    imports: z.array(z.unknown()),
    total: z.number().optional(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const response = await new PublicApiClient().request<unknown>(
      "GET",
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(input.mailbox_name)}/email_imports`,
      { query: cleanQuery(input.query) },
    );
    const collection = collectionFrom(response);
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      imports: collection.items,
      ...(collection.total === undefined ? {} : { total: collection.total }),
    };
  },
});

const FilterLifecycleInput = MailboxInput.extend({
  action: z.enum(["set_activation", "reorder", "set_script_activation"]),
  filter_name: z.string().min(1).optional(),
  is_enabled: z.boolean().optional(),
  order: z.array(z.string().min(1)).min(1).optional(),
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if (input.action === "reorder" && input.order === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["order"], message: "order is required for reorder." });
  }
  if (input.action !== "reorder" && (input.filter_name === undefined || input.is_enabled === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["filter_name"], message: "filter_name and is_enabled are required for activation changes." });
  }
});

export const manageMailboxFilterLifecycleTool = defineTool({
  name: "infomaniak_manage_mailbox_filter_lifecycle",
  description:
    "Enable/disable mailbox filters or Sieve scripts, or reorder filters. All changes use two-phase confirmation with a fresh filter snapshot.",
  inputSchema: FilterLifecycleInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof FilterLifecycleInput>,
    unknown,
    { plan: { action: string; payload: Record<string, unknown> }; current_filters: unknown },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_manage_mailbox_filter_lifecycle",
    loadCurrent: async (input) => readMailboxFilters(input.mail_hosting_id, input.mailbox_name),
    buildPlan: (input, current_filters) => ({
      plan: { action: input.action, payload: filterPayload(input) },
      current_filters,
    }),
    fingerprintPayload: (input, current_filters, plan) => ({
      tool: "infomaniak_manage_mailbox_filter_lifecycle",
      input: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        action: input.action,
      },
      current_filters,
      plan,
    }),
    apply: async (input, plan) => {
      const path = filterLifecyclePath(input);
      const result = await new PublicApiClient().request<unknown>("PUT", path, { body: plan.plan.payload });
      recordHistory({
        tool: "infomaniak_manage_mailbox_filter_lifecycle",
        kind: "mail_admin",
        summary: `Updated mailbox filter lifecycle for ${input.mailbox_name}`,
        payload: { mail_hosting_id: input.mail_hosting_id, mailbox_name: input.mailbox_name, action: input.action },
      });
      return { result, message: `✅ Mailbox filter action ${input.action} applied.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — mailbox filter lifecycle",
      "",
      `- **Mailbox**: ${input.mailbox_name}`,
      `- **Action**: ${plan.plan.action}`,
      `- **Payload**: \`${JSON.stringify(plan.plan.payload)}\``,
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

const EmptyTrashInput = MailboxInput.extend({ confirmation_token: z.string().uuid().optional() });

export const emptyMailboxTrashTool = defineTool({
  name: "infomaniak_empty_mailbox_trash",
  description: "Permanently delete all messages in a mailbox trash folder after confirmation.",
  inputSchema: EmptyTrashInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof EmptyTrashInput>,
    unknown,
    { plan: { mail_hosting_id: number; mailbox_name: string }; current_mailbox: unknown },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_empty_mailbox_trash",
    loadCurrent: async (input) => readMailbox(input.mail_hosting_id, input.mailbox_name),
    buildPlan: (input, current_mailbox) => ({
      plan: { mail_hosting_id: input.mail_hosting_id, mailbox_name: input.mailbox_name },
      current_mailbox,
    }),
    apply: async (input) => {
      const result = await new PublicApiClient().request<unknown>(
        "DELETE",
        `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(input.mailbox_name)}/auth/folders/trash`,
      );
      recordHistory({
        tool: "infomaniak_empty_mailbox_trash",
        kind: "mail_admin",
        summary: `Emptied mailbox trash for ${input.mailbox_name}`,
        payload: { mail_hosting_id: input.mail_hosting_id, mailbox_name: input.mailbox_name },
      });
      return { result, message: `✅ Mailbox trash emptied for ${input.mailbox_name}.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — empty mailbox trash",
      "",
      `- **Mailbox**: ${plan.plan.mailbox_name}`,
      "- **Effect**: permanently deletes all messages currently in Trash.",
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

export const listMailingListsTool = defineTool({
  name: "infomaniak_list_mailing_lists",
  description: "List mailing lists configured on a mail hosting.",
  inputSchema: z.object({ mail_hosting_id: z.number().int().positive() }),
  outputSchema: z.object({ mail_hosting_id: z.number(), mailing_lists: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    mail_hosting_id: input.mail_hosting_id,
    mailing_lists: await new PublicApiClient().request<unknown[]>("GET", `/1/mail_hostings/${input.mail_hosting_id}/mailing_lists`),
  }),
});

export const listServiceAutoRepliesTool = defineTool({
  name: "infomaniak_list_service_auto_replies",
  description: "List service-level auto-reply configurations for a mail hosting.",
  inputSchema: z.object({ mail_hosting_id: z.number().int().positive() }),
  outputSchema: z.object({ mail_hosting_id: z.number(), auto_replies: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    mail_hosting_id: input.mail_hosting_id,
    auto_replies: await new PublicApiClient().request<unknown[]>("GET", `/1/mail_hostings/${input.mail_hosting_id}/auto_replies`),
  }),
});

export const getMailPreferencesTool = defineTool({
  name: "infomaniak_get_mail_preferences",
  description: "Read service-level mail preferences for a mail hosting.",
  inputSchema: z.object({ mail_hosting_id: z.number().int().positive() }),
  outputSchema: z.object({ mail_hosting_id: z.number(), preferences: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    mail_hosting_id: input.mail_hosting_id,
    preferences: await new PublicApiClient().request<unknown>("GET", `/1/mail_hostings/${input.mail_hosting_id}/preferences`),
  }),
});

export const listServiceFilterModelsTool = defineTool({
  name: "infomaniak_list_service_filter_models",
  description: "List service-level reusable mail filter models.",
  inputSchema: z.object({ mail_hosting_id: z.number().int().positive() }),
  outputSchema: z.object({ mail_hosting_id: z.number(), filters: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    mail_hosting_id: input.mail_hosting_id,
    filters: await new PublicApiClient().request<unknown[]>("GET", `/1/mail_hostings/${input.mail_hosting_id}/filters`),
  }),
});

function filterPayload(input: z.infer<typeof FilterLifecycleInput>): Record<string, unknown> {
  if (input.action === "reorder") return { order: input.order };
  return { name: input.filter_name, is_enabled: input.is_enabled };
}

function filterLifecyclePath(input: z.infer<typeof FilterLifecycleInput>): string {
  const base = `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(input.mailbox_name)}/auth/filters`;
  return input.action === "set_script_activation"
    ? `${base}/scripts/set_activation`
    : `${base}/${input.action}`;
}

async function readMailboxFilters(hostingId: number, mailboxName: string): Promise<unknown> {
  return new PublicApiClient().request<unknown>(
    "GET",
    `/1/mail_hostings/${hostingId}/mailboxes/${encodeURIComponent(mailboxName)}/auth/filters`,
  );
}

async function readMailbox(hostingId: number, mailboxName: string): Promise<unknown> {
  return new PublicApiClient().request<unknown>(
    "GET",
    `/1/mail_hostings/${hostingId}/mailboxes/${encodeURIComponent(mailboxName)}`,
  );
}

function cleanQuery(query: Record<string, unknown> | undefined): Record<string, QueryValue> {
  const result: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function collectionFrom(value: unknown): { items: unknown[]; total?: number } {
  if (Array.isArray(value)) return { items: value };
  if (typeof value !== "object" || value === null) return { items: [value] };
  const record = value as Record<string, unknown>;
  const rawItems = record.data ?? record.items ?? record.imports;
  return {
    items: Array.isArray(rawItems) ? rawItems : [],
    ...(typeof record.total === "number" ? { total: record.total } : {}),
  };
}
