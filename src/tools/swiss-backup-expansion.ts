import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const GenericMutationOutput = z
  .union([
    z.object({ status: z.literal("plan"), confirmation_token: z.string(), token_expires_at: z.string(), next_step_markdown: z.string() }).passthrough(),
    z.object({ status: z.literal("applied"), message: z.string() }).passthrough(),
  ]);

const BackupInput = z.object({ swiss_backup_id: z.number().int().positive() });
const SlotInput = BackupInput.extend({ slot_id: z.number().int().positive() });

export const getSwissBackupTool = defineTool({
  name: "infomaniak_get_swiss_backup",
  description: "Read one Swiss Backup subscription in detail.",
  inputSchema: BackupInput,
  outputSchema: z.object({ swiss_backup_id: z.number(), backup: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    swiss_backup_id: input.swiss_backup_id,
    backup: await new PublicApiClient().request<unknown>("GET", `/1/swiss_backups/${input.swiss_backup_id}`),
  }),
});

export const getSwissBackupAcronisInfoTool = defineTool({
  name: "infomaniak_get_swiss_backup_acronis_info",
  description: "Read Acronis connection information for a Swiss Backup subscription.",
  inputSchema: BackupInput,
  outputSchema: z.object({ swiss_backup_id: z.number(), acronis: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    swiss_backup_id: input.swiss_backup_id,
    acronis: await new PublicApiClient().request<unknown>("GET", `/1/swiss_backups/${input.swiss_backup_id}/acronis_informations`),
  }),
});

export const listSwissBackupSlotsTool = defineTool({
  name: "infomaniak_list_swiss_backup_slots",
  description: "List backup slots belonging to a Swiss Backup subscription.",
  inputSchema: BackupInput,
  outputSchema: z.object({ swiss_backup_id: z.number(), slots: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    swiss_backup_id: input.swiss_backup_id,
    slots: await new PublicApiClient().request<unknown[]>("GET", `/1/swiss_backups/${input.swiss_backup_id}/slots`),
  }),
});

export const getSwissBackupSlotTool = defineTool({
  name: "infomaniak_get_swiss_backup_slot",
  description: "Read one Swiss Backup slot.",
  inputSchema: SlotInput,
  outputSchema: z.object({ swiss_backup_id: z.number(), slot_id: z.number(), slot: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    swiss_backup_id: input.swiss_backup_id,
    slot_id: input.slot_id,
    slot: await new PublicApiClient().request<unknown>("GET", `/1/swiss_backups/${input.swiss_backup_id}/slots/${input.slot_id}`),
  }),
});

export const getSwissBackupPricingTool = defineTool({
  name: "infomaniak_get_swiss_backup_pricing",
  description: "Read Swiss Backup pricing or calculate a price from query parameters.",
  inputSchema: z.object({ calculate: z.boolean().default(false), query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional() }),
  outputSchema: z.object({ calculate: z.boolean(), data: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    calculate: input.calculate,
    data: await new PublicApiClient().request<unknown>("GET", input.calculate ? "/1/swiss_backups/calculate" : "/1/swiss_backups/pricing", input.query === undefined ? {} : { query: input.query }),
  }),
});

const SlotMutationInput = BackupInput.extend({
  slot_id: z.number().int().positive().optional(),
  action: z.enum(["create", "update", "delete", "enable", "disable"]),
  payload: z.record(z.unknown()).default({}),
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if (input.action !== "create" && input.slot_id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["slot_id"], message: "slot_id is required for this action." });
  }
});

export const manageSwissBackupSlotTool = defineTool({
  name: "infomaniak_manage_swiss_backup_slot",
  description: "Create, update, delete, enable, or disable a Swiss Backup slot with two-phase confirmation.",
  inputSchema: SlotMutationInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<z.infer<typeof SlotMutationInput>, unknown, { plan: { action: string; payload: Record<string, unknown> }; current_slots: unknown }, { result: unknown; message: string }>({
    toolName: "infomaniak_manage_swiss_backup_slot",
    loadCurrent: async (input) => new PublicApiClient().request<unknown>("GET", `/1/swiss_backups/${input.swiss_backup_id}/slots`),
    buildPlan: (input, current_slots) => ({ plan: { action: input.action, payload: input.payload }, current_slots }),
    apply: async (input, plan) => {
      const base = `/1/swiss_backups/${input.swiss_backup_id}/slots`;
      const id = input.slot_id === undefined ? "" : `/${input.slot_id}`;
      const suffix = input.action === "enable" ? "/enable" : input.action === "disable" ? "/disable" : "";
      const method = input.action === "create" ? "POST" : input.action === "update" ? "PUT" : input.action === "delete" ? "DELETE" : "POST";
      const result = await new PublicApiClient().request(method, input.action === "create" ? base : `${base}${id}${suffix}`, input.action === "delete" ? {} : { body: plan.plan.payload });
      recordHistory({ tool: "infomaniak_manage_swiss_backup_slot", kind: "account_admin", summary: `${input.action}d Swiss Backup slot`, payload: { swiss_backup_id: input.swiss_backup_id, slot_id: input.slot_id } });
      return { result, message: `✅ Swiss Backup slot ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => `## Plan — Swiss Backup slot\n\n- **Action**: ${plan.plan.action}\n- **Slot**: ${input.slot_id ?? "new"}\n- **Payload**: \`${JSON.stringify(plan.plan.payload)}\`\n\nRe-call with the same parameters and \`confirmation_token: "${token}"\`.`,
  }),
});

const AdminMutationInput = BackupInput.extend({
  action: z.enum(["create", "update"]),
  payload: z.record(z.unknown()),
  confirmation_token: z.string().uuid().optional(),
});

export const manageSwissBackupAdministratorTool = defineTool({
  name: "infomaniak_manage_swiss_backup_administrator",
  description: "Create or update the administrator for a Swiss Backup subscription with two-phase confirmation.",
  inputSchema: AdminMutationInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<z.infer<typeof AdminMutationInput>, unknown, { plan: { action: string; payload: Record<string, unknown> }; current_backup: unknown }, { result: unknown; message: string }>({
    toolName: "infomaniak_manage_swiss_backup_administrator",
    loadCurrent: async (input) => new PublicApiClient().request<unknown>("GET", `/1/swiss_backups/${input.swiss_backup_id}`),
    buildPlan: (input, current_backup) => ({ plan: { action: input.action, payload: input.payload }, current_backup }),
    apply: async (input, plan) => {
      const method = input.action === "create" ? "POST" : "PUT";
      const result = await new PublicApiClient().request(method, `/1/swiss_backups/${input.swiss_backup_id}/admin`, { body: plan.plan.payload });
      recordHistory({ tool: "infomaniak_manage_swiss_backup_administrator", kind: "account_admin", summary: `${input.action}d Swiss Backup administrator`, payload: { swiss_backup_id: input.swiss_backup_id } });
      return { result, message: `✅ Swiss Backup administrator ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => `## Plan — Swiss Backup administrator\n\n- **Action**: ${plan.plan.action}\n- **Payload**: \`${JSON.stringify(plan.plan.payload)}\`\n\nRe-call with the same parameters and \`confirmation_token: "${token}"\`.`,
  }),
});
