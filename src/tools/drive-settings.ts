import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const DriveIdInput = z.object({
  drive_id: z
    .number()
    .int()
    .positive()
    .describe("kDrive id. Discover via infomaniak_list_drives."),
});

const DriveSettingsActionSchema = z.enum([
  "update_ai",
  "update_link",
  "update_office",
  "update_preferences",
]);

const ManageDriveSettingsInput = DriveIdInput.extend({
  action: DriveSettingsActionSchema,
  settings: z
    .record(z.unknown())
    .describe(
      "Settings payload accepted by the matching kDrive settings endpoint.",
    ),
  confirmation_token: z.string().uuid().optional(),
});

const DriveSettingsOutput = z.object({
  drive_id: z.number(),
  settings: z.record(z.unknown()),
  summary_markdown: z.string(),
});

const ConfirmedDriveSettingsOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      action: DriveSettingsActionSchema,
    }),
    current_settings: z.record(z.unknown()),
    settings: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    action: DriveSettingsActionSchema,
    settings: z.record(z.unknown()),
    message: z.string(),
  }),
]);

export const getDriveSettingsTool = defineTool({
  name: "infomaniak_get_drive_settings",
  description:
    "Read the current kDrive policy settings snapshot for AI, share links, office, and preferences.",
  inputSchema: DriveIdInput,
  outputSchema: DriveSettingsOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const settings = await readDriveSettings(input.drive_id);
    return {
      drive_id: input.drive_id,
      settings,
      summary_markdown: renderDriveSettingsReadMarkdown(
        input.drive_id,
        settings,
      ),
    };
  },
});

export const manageDriveSettingsTool = defineTool({
  name: "infomaniak_manage_drive_settings",
  description:
    "Update kDrive AI, share-link, office, or preferences settings. Two-phase confirmation with a fresh settings snapshot guard.",
  inputSchema: ManageDriveSettingsInput,
  outputSchema: ConfirmedDriveSettingsOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof ManageDriveSettingsInput>,
    Record<string, unknown>,
    {
      plan: {
        drive_id: number;
        action: z.infer<typeof DriveSettingsActionSchema>;
      };
      current_settings: Record<string, unknown>;
      settings: Record<string, unknown>;
    },
    {
      drive_id: number;
      action: z.infer<typeof DriveSettingsActionSchema>;
      settings: Record<string, unknown>;
      message: string;
    }
  >({
    toolName: "infomaniak_manage_drive_settings",
    loadCurrent: async (input) => readDriveSettings(input.drive_id),
    buildPlan: (input, currentSettings) => ({
      plan: { drive_id: input.drive_id, action: input.action },
      current_settings: currentSettings,
      settings: input.settings,
    }),
    fingerprintPayload: (input, currentSettings, plan) => ({
      tool: "infomaniak_manage_drive_settings",
      drive_id: input.drive_id,
      action: input.action,
      current_settings: currentSettings,
      plan,
      settings: input.settings,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      const { method, path } = driveSettingsMutationFor(
        input.drive_id,
        input.action,
      );
      await client.request<unknown>(method, path, { body: plan.settings });
      recordHistory({
        tool: "infomaniak_manage_drive_settings",
        kind: "kdrive_admin",
        summary: `Updated ${input.action} on kDrive ${input.drive_id}`,
        payload: {
          drive_id: input.drive_id,
          action: input.action,
          settings: plan.settings,
        },
      });
      return {
        drive_id: input.drive_id,
        action: input.action,
        settings: plan.settings,
        message: `✅ kDrive ${input.action.replace("update_", "")} settings updated.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveSettingsPlanMarkdown(
        input.drive_id,
        input.action,
        plan.current_settings,
        plan.settings,
        token,
      ),
  }),
});

async function readDriveSettings(
  driveId: number,
): Promise<Record<string, unknown>> {
  const client = new PublicApiClient();
  const settings = await client.request<unknown>(
    "GET",
    `/2/drive/${driveId}/settings`,
  );
  return isRecord(settings) ? settings : { value: settings };
}

function driveSettingsMutationFor(
  driveId: number,
  action: z.infer<typeof DriveSettingsActionSchema>,
): { method: "PUT"; path: string } {
  switch (action) {
    case "update_ai":
      return { method: "PUT", path: `/2/drive/${driveId}/settings/ai` };
    case "update_link":
      return { method: "PUT", path: `/2/drive/${driveId}/settings/link` };
    case "update_office":
      return { method: "PUT", path: `/2/drive/${driveId}/settings/office` };
    case "update_preferences":
      return { method: "PUT", path: `/2/drive/${driveId}/preferences` };
    default:
      throw new Error(`Unsupported drive settings action: ${action}`);
  }
}

function renderDriveSettingsReadMarkdown(
  driveId: number,
  settings: Record<string, unknown>,
): string {
  return [
    `# kDrive settings`,
    ``,
    `- **Drive**: ${driveId}`,
    `- **Snapshot keys**: ${Object.keys(settings).slice(0, 20).join(", ") || "(none)"}`,
    ``,
    `Use \`infomaniak_manage_drive_settings\` to update AI, share-link, office, or preferences settings after confirming the current snapshot.`,
  ].join("\n");
}

function renderDriveSettingsPlanMarkdown(
  driveId: number,
  action: z.infer<typeof DriveSettingsActionSchema>,
  currentSettings: Record<string, unknown>,
  settings: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan - manage kDrive settings`,
    ``,
    `- **Drive**: ${driveId}`,
    `- **Action**: ${action}`,
    `- **Endpoint**: \`${driveSettingsMutationFor(driveId, action).method} ${driveSettingsMutationFor(driveId, action).path}\``,
    `- **Current settings snapshot**: \`${JSON.stringify(currentSettings)}\``,
    `- **Requested settings**: \`${JSON.stringify(settings)}\``,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_manage_drive_settings\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
