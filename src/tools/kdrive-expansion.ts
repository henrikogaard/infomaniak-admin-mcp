import { z } from "zod";

import { PublicApiClient, type QueryValue } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const DriveIdInput = z.object({
  drive_id: z.number().int().positive().describe("kDrive identifier."),
});

const LanguageSchema = z.enum(["de", "en", "es", "fr", "it", "nl", "pt"]);

const ActivityQuerySchema = z
  .object({
    with: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().positive().max(500).optional(),
    order_by: z.array(z.string()).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    order_for: z.array(z.string()).optional(),
    lang: LanguageSchema.default("en"),
    actions: z.array(z.string()).optional(),
    depth: z.enum(["children", "file", "folder", "unlimited"]).optional(),
    files: z.array(z.number().int().positive()).optional(),
    from: z.number().int().optional(),
    terms: z.string().min(3).optional(),
    until: z.number().int().optional(),
    users: z.array(z.number().int().positive()).optional(),
  });

const ActivityOutput = z.object({
  drive_id: z.number(),
  data: z.unknown(),
  cursor: z.string().optional(),
  has_more: z.boolean().optional(),
  response_at: z.number().optional(),
  summary_markdown: z.string(),
});

const ReportQuerySchema = z
  .object({
    with: z.enum(["filters", "total"]).optional(),
    users: z.array(z.number().int().positive()).optional(),
    page: z.number().int().positive().optional(),
    per_page: z.number().int().positive().max(500).optional(),
    total: z.boolean().optional(),
    order_by: z
      .enum(["created_at", "start_at", "end_at", "status", "size"])
      .optional(),
    order: z.enum(["asc", "desc"]).optional(),
  })
  .partial();

const ReportPayloadSchema = z
  .object({
    actions: z.array(z.string()).optional(),
    depth: z.enum(["children", "file", "folder", "unlimited"]).optional(),
    files: z.array(z.number().int().positive()).optional(),
    from: z.number().int().optional(),
    terms: z.string().min(3).optional(),
    until: z.number().int().optional(),
    user_id: z.number().int().positive().nullable().optional(),
    users: z.array(z.number().int().positive()).optional(),
  })
  .passthrough();

const ReportReadInput = DriveIdInput.extend({
  query: ReportQuerySchema.optional(),
});

const ReportIdInput = DriveIdInput.extend({
  report_id: z.number().int().positive(),
  query: ReportQuerySchema.optional(),
});

const ReportCreateInput = DriveIdInput.extend({
  lang: LanguageSchema.default("en"),
  payload: ReportPayloadSchema.default({}),
  confirmation_token: z.string().uuid().optional(),
});

const ReportDeleteInput = DriveIdInput.extend({
  report_id: z.number().int().positive(),
  confirmation_token: z.string().uuid().optional(),
});

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

export const getDriveActivitiesTool = defineTool({
  name: "infomaniak_get_drive_activities",
  description:
    "Read kDrive activity history across users, files, actions, and time ranges. Supports cursor pagination and repeated action/file/user filters.",
  inputSchema: DriveIdInput.extend({
    query: ActivityQuerySchema.default({ lang: "en" }),
  }),
  outputSchema: ActivityOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const response = await client.request<unknown>(
      "GET",
      `/3/drive/${input.drive_id}/activities`,
      { query: cleanQuery(input.query) },
    );
    return activityOutput(input.drive_id, response);
  },
});

const FileActivityInput = DriveIdInput.extend({
  file_id: z.number().int().positive(),
  query: ActivityQuerySchema.default({ lang: "en" }),
});

export const getDriveFileActivitiesTool = defineTool({
  name: "infomaniak_get_drive_file_activities",
  description: "Read activity history for one kDrive file or folder.",
  inputSchema: FileActivityInput,
  outputSchema: ActivityOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => activityOutput(
    input.drive_id,
    await new PublicApiClient().request<unknown>(
      "GET",
      `/3/drive/${input.drive_id}/files/${input.file_id}/activities`,
      { query: cleanQuery(input.query) },
    ),
  ),
});

export const getDriveRootActivitiesTool = defineTool({
  name: "infomaniak_get_drive_root_activities",
  description: "Read activity history for root-level kDrive files and folders.",
  inputSchema: DriveIdInput.extend({ query: ActivityQuerySchema.default({ lang: "en" }) }),
  outputSchema: ActivityOutput,
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => activityOutput(
    input.drive_id,
    await new PublicApiClient().request<unknown>(
      "GET",
      `/3/drive/${input.drive_id}/files/activities`,
      { query: cleanQuery(input.query) },
    ),
  ),
});

export const listDriveActivityReportsTool = defineTool({
  name: "infomaniak_list_drive_activity_reports",
  description:
    "List generated kDrive activity reports, optionally filtered by users and report status metadata.",
  inputSchema: ReportReadInput,
  outputSchema: z.object({
    drive_id: z.number(),
    data: z.unknown(),
    summary_markdown: z.string(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    drive_id: input.drive_id,
    data: await readReports(input.drive_id, input.query),
    summary_markdown: `# kDrive activity reports\n\n- **Drive**: ${input.drive_id}`,
  }),
});

export const getDriveActivityReportTool = defineTool({
  name: "infomaniak_get_drive_activity_report",
  description: "Read one generated kDrive activity report.",
  inputSchema: ReportIdInput,
  outputSchema: z.object({
    drive_id: z.number(),
    report_id: z.number(),
    data: z.unknown(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    return {
      drive_id: input.drive_id,
      report_id: input.report_id,
      data: await client.request<unknown>(
        "GET",
        `/2/drive/${input.drive_id}/activities/reports/${input.report_id}`,
        { query: cleanQuery(input.query) },
      ),
    };
  },
});

export const exportDriveActivityReportTool = defineTool({
  name: "infomaniak_export_drive_activity_report",
  description: "Download the generated output for a kDrive activity report.",
  inputSchema: ReportIdInput,
  outputSchema: z.object({
    drive_id: z.number(),
    report_id: z.number(),
    data: z.unknown(),
  }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    return {
      drive_id: input.drive_id,
      report_id: input.report_id,
      data: await client.request<unknown>(
        "GET",
        `/2/drive/${input.drive_id}/activities/reports/${input.report_id}/export`,
        { query: cleanQuery(input.query) },
      ),
    };
  },
});

export const createDriveActivityReportTool = defineTool({
  name: "infomaniak_create_drive_activity_report",
  description:
    "Create a kDrive activity report. Two-phase confirmation is required because Infomaniak starts report generation asynchronously.",
  inputSchema: ReportCreateInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof ReportCreateInput>,
    unknown,
    { plan: { drive_id: number; lang: string; payload: Record<string, unknown> }; current_reports: unknown },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_create_drive_activity_report",
    loadCurrent: async (input) => readReports(input.drive_id),
    buildPlan: (input, current_reports) => ({
      plan: { drive_id: input.drive_id, lang: input.lang, payload: input.payload },
      current_reports,
    }),
    fingerprintPayload: (input, current_reports, plan) => ({
      tool: "infomaniak_create_drive_activity_report",
      input: { drive_id: input.drive_id, lang: input.lang, payload: input.payload },
      current_reports,
      plan,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      const result = await client.request<unknown>(
        "POST",
        `/2/drive/${input.drive_id}/activities/reports`,
        {
          query: { lang: plan.plan.lang },
          body: { ...plan.plan.payload, lang: plan.plan.lang },
        },
      );
      recordHistory({
        tool: "infomaniak_create_drive_activity_report",
        kind: "kdrive_admin",
        summary: `Created activity report for kDrive ${input.drive_id}`,
        payload: { drive_id: input.drive_id, payload: plan.plan.payload },
      });
      return { result, message: `✅ kDrive activity report requested for drive ${input.drive_id}.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — create kDrive activity report",
      "",
      `- **Drive**: ${input.drive_id}`,
      `- **Language**: ${plan.plan.lang}`,
      `- **Filters**: \`${JSON.stringify(plan.plan.payload)}\``,
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

export const deleteDriveActivityReportTool = defineTool({
  name: "infomaniak_delete_drive_activity_report",
  description: "Delete a generated kDrive activity report with a current-state guard.",
  inputSchema: ReportDeleteInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof ReportDeleteInput>,
    unknown,
    { plan: { drive_id: number; report_id: number }; current_report: unknown },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_delete_drive_activity_report",
    loadCurrent: async (input) => readReport(input.drive_id, input.report_id),
    buildPlan: (input, current_report) => ({
      plan: { drive_id: input.drive_id, report_id: input.report_id },
      current_report,
    }),
    apply: async (input) => {
      const client = new PublicApiClient();
      const result = await client.request<unknown>(
        "DELETE",
        `/2/drive/${input.drive_id}/activities/reports/${input.report_id}`,
      );
      recordHistory({
        tool: "infomaniak_delete_drive_activity_report",
        kind: "kdrive_admin",
        summary: `Deleted activity report ${input.report_id} from kDrive ${input.drive_id}`,
        payload: { drive_id: input.drive_id, report_id: input.report_id },
      });
      return { result, message: `✅ kDrive activity report ${input.report_id} deleted.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — delete kDrive activity report",
      "",
      `- **Drive**: ${input.drive_id}`,
      `- **Report**: ${plan.plan.report_id}`,
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

const DriveUserInput = DriveIdInput.extend({
  user_id: z.number().int().positive(),
});

export const getDriveUserTool = defineTool({
  name: "infomaniak_get_drive_user",
  description: "Read the complete user snapshot for a kDrive user.",
  inputSchema: DriveUserInput,
  outputSchema: z.object({ drive_id: z.number(), user_id: z.number(), user: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    drive_id: input.drive_id,
    user_id: input.user_id,
    user: await new PublicApiClient().request<unknown>(
      "GET",
      `/2/drive/${input.drive_id}/users/${input.user_id}`,
    ),
  }),
});

export const listDriveInvitationsTool = defineTool({
  name: "infomaniak_list_drive_invitations",
  description: "List pending kDrive user invitations for access review.",
  inputSchema: DriveIdInput,
  outputSchema: z.object({ drive_id: z.number(), invitations: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    drive_id: input.drive_id,
    invitations: await new PublicApiClient().request<unknown>(
      "GET",
      `/2/drive/${input.drive_id}/users/invitation`,
    ),
  }),
});

export const getDriveInvitationTool = defineTool({
  name: "infomaniak_get_drive_invitation",
  description: "Read one pending kDrive user invitation.",
  inputSchema: DriveIdInput.extend({ invitation_id: z.number().int().positive() }),
  outputSchema: z.object({ drive_id: z.number(), invitation_id: z.number(), invitation: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    drive_id: input.drive_id,
    invitation_id: input.invitation_id,
    invitation: await new PublicApiClient().request<unknown>(
      "GET",
      `/2/drive/${input.drive_id}/users/invitation/${input.invitation_id}`,
    ),
  }),
});

const PrivateDirectoryInput = DriveIdInput.extend({
  size_threshold: z.number().int().min(0).nullable(),
  confirmation_token: z.string().uuid().optional(),
});

export const manageDrivePrivateDirectoryTool = defineTool({
  name: "infomaniak_manage_drive_private_directory",
  description:
    "Update the maximum allowed size of kDrive private folders. Two-phase confirmation with a fresh settings snapshot; null removes the limit.",
  inputSchema: PrivateDirectoryInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof PrivateDirectoryInput>,
    Record<string, unknown>,
    { plan: { drive_id: number; size_threshold: number | null }; current_settings: Record<string, unknown> },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_manage_drive_private_directory",
    loadCurrent: async (input) => readDriveSettings(input.drive_id),
    buildPlan: (input, current_settings) => ({
      plan: { drive_id: input.drive_id, size_threshold: input.size_threshold },
      current_settings,
    }),
    apply: async (input, plan) => {
      const result = await new PublicApiClient().request<unknown>(
        "PUT",
        `/2/drive/${input.drive_id}/settings/files/private`,
        { body: { size_threshold: plan.plan.size_threshold } },
      );
      recordHistory({
        tool: "infomaniak_manage_drive_private_directory",
        kind: "kdrive_admin",
        summary: `Updated private-directory policy for kDrive ${input.drive_id}`,
        payload: { drive_id: input.drive_id, size_threshold: plan.plan.size_threshold },
      });
      return { result, message: `✅ kDrive ${input.drive_id} private-directory policy updated.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — update kDrive private-directory policy",
      "",
      `- **Drive**: ${input.drive_id}`,
      `- **Current settings**: \`${JSON.stringify(plan.current_settings)}\``,
      `- **New size threshold**: ${plan.plan.size_threshold === null ? "unlimited" : `${plan.plan.size_threshold} bytes`}`,
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

async function readReports(
  driveId: number,
  query?: Record<string, unknown>,
): Promise<unknown> {
  return new PublicApiClient().request<unknown>(
    "GET",
    `/2/drive/${driveId}/activities/reports`,
    { query: cleanQuery(query) },
  );
}

async function readReport(driveId: number, reportId: number): Promise<unknown> {
  return new PublicApiClient().request<unknown>(
    "GET",
    `/2/drive/${driveId}/activities/reports/${reportId}`,
  );
}

async function readDriveSettings(driveId: number): Promise<Record<string, unknown>> {
  const settings = await new PublicApiClient().request<unknown>(
    "GET",
    `/2/drive/${driveId}/settings`,
  );
  return isRecord(settings) ? settings : { value: settings };
}

function activityOutput(driveId: number, response: unknown): z.infer<typeof ActivityOutput> {
  if (isRecord(response)) {
    return {
      drive_id: driveId,
      data: response.data ?? response,
      ...(typeof response.cursor === "string" ? { cursor: response.cursor } : {}),
      ...(typeof response.has_more === "boolean" ? { has_more: response.has_more } : {}),
      ...(typeof response.response_at === "number" ? { response_at: response.response_at } : {}),
      summary_markdown: `# kDrive activities\n\n- **Drive**: ${driveId}`,
    };
  }
  return {
    drive_id: driveId,
    data: response,
    summary_markdown: `# kDrive activities\n\n- **Drive**: ${driveId}`,
  };
}

function cleanQuery(query: Record<string, unknown> | undefined): Record<string, QueryValue> {
  const result: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item)))
    ) {
      result[key] = value as QueryValue;
    }
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
