import { z } from "zod";

import { InfomaniakNotFoundError } from "../infomaniak/errors.js";
import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool, type ToolDefinition } from "./types.js";

const KdriveAdminAuditInput = z.object({
  drive_id: z
    .number()
    .int()
    .positive()
    .describe("kDrive id. Discover via infomaniak_list_drives."),
  storage_warning_ratio: z
    .number()
    .min(0.5)
    .max(0.99)
    .default(0.9)
    .describe(
      "Warn when used_size / size is at or above this ratio. Default 0.9.",
    ),
});

const KdriveFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  category: z.string(),
  message: z.string(),
  count: z.number().optional(),
});

const KdriveAdminAuditOutput = z.object({
  drive_id: z.number(),
  drive_name: z.string().optional(),
  summary: z.object({
    users: z.number(),
    admin_users: z.number(),
    external_users: z.number(),
    share_links: z.number(),
    risky_share_links: z.number(),
    trash_items: z.number(),
    storage_ratio: z.number().nullable(),
  }),
  drive: z.unknown(),
  settings: z.unknown(),
  findings: z.array(KdriveFindingSchema),
  summary_markdown: z.string(),
});

const DriveTrashInput = z.object({
  drive_id: z
    .number()
    .int()
    .positive()
    .describe("kDrive id. Discover via infomaniak_list_drives."),
  confirmation_token: z.string().uuid().optional(),
});

const DriveInput = z.object({
  drive_id: z
    .number()
    .int()
    .positive()
    .describe("kDrive id. Discover via infomaniak_list_drives."),
});

const DriveFileInput = DriveInput.extend({
  file_id: z.number().int().positive().describe("kDrive file or folder id."),
});

const ConfirmableDriveFileInput = DriveFileInput.extend({
  confirmation_token: z.string().uuid().optional(),
});

const DriveTrashItemInput = DriveTrashInput.extend({
  file_id: z.number().int().positive().describe("Trashed file or folder id."),
});

const DriveTrashSettingsInput = DriveTrashInput.extend({
  settings: z
    .record(z.unknown())
    .describe(
      "Trash settings payload accepted by Infomaniak's PUT /2/drive/{drive_id}/settings/trash endpoint.",
    ),
});

const DriveUserCreateInput = DriveTrashInput.extend({
  user: z
    .record(z.unknown())
    .describe(
      "User payload accepted by Infomaniak's POST /2/drive/{drive_id}/users endpoint.",
    ),
});

const DriveUserMutationInput = DriveTrashInput.extend({
  user_id: z.number().int().positive().describe("kDrive user id."),
});

const DriveUserUpdateInput = DriveUserMutationInput.extend({
  user: z
    .record(z.unknown())
    .describe(
      "User update payload accepted by Infomaniak's PUT /2/drive/{drive_id}/users/{user_id} endpoint.",
    ),
});

const DriveUserManagerInput = DriveUserMutationInput.extend({
  is_manager: z
    .boolean()
    .describe("Whether the drive user should have manager rights."),
});

const DriveShareLinkPayloadInput = ConfirmableDriveFileInput.extend({
  link: z
    .record(z.unknown())
    .describe(
      "Share-link payload accepted by Infomaniak's /2/drive/{drive_id}/files/{file_id}/link endpoints.",
    ),
});

const DriveShareLinkInviteInput = ConfirmableDriveFileInput.extend({
  invitation: z
    .record(z.unknown())
    .describe(
      "Invitation payload accepted by Infomaniak's POST /2/drive/{drive_id}/files/{file_id}/link/invite endpoint.",
    ),
});

const DriveFileAccessListInput = DriveFileInput;

const DriveFileAccessUserWriteInput = ConfirmableDriveFileInput.extend({
  user_id: z
    .number()
    .int()
    .positive()
    .describe("User id to grant or update access for."),
  payload: z
    .record(z.unknown())
    .describe(
      "Access payload accepted by Infomaniak's file access users endpoints.",
    ),
});

const DriveFileAccessUserRemoveInput = ConfirmableDriveFileInput.extend({
  user_id: z
    .number()
    .int()
    .positive()
    .describe("User id to revoke access for."),
});

const DriveFileAccessTeamWriteInput = ConfirmableDriveFileInput.extend({
  team_id: z
    .number()
    .int()
    .positive()
    .describe("Team id to grant or update access for."),
  payload: z
    .record(z.unknown())
    .describe(
      "Access payload accepted by Infomaniak's file access teams endpoints.",
    ),
});

const DriveFileAccessTeamRemoveInput = ConfirmableDriveFileInput.extend({
  team_id: z
    .number()
    .int()
    .positive()
    .describe("Team id to revoke access for."),
});

const DriveFileAccessInvitationInput = ConfirmableDriveFileInput.extend({
  payload: z
    .record(z.unknown())
    .describe(
      "Invitation payload accepted by Infomaniak's file access invitations endpoint.",
    ),
});

const DriveStatisticSchema = z.enum([
  "sizes",
  "activities",
  "activities_users",
  "shared_files",
  "share_links",
]);

const DriveStatisticsInput = DriveInput.extend({
  statistic: DriveStatisticSchema.describe("Statistic family to fetch."),
  export: z
    .boolean()
    .default(false)
    .describe("Use the export endpoint when available."),
  query: z
    .record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Optional query parameters such as date range filters."),
});

const DriveShareLinksOutput = z.object({
  drive_id: z.number(),
  links: z.array(z.unknown()),
  summary_markdown: z.string(),
});

const DriveShareLinkOutput = z.object({
  drive_id: z.number(),
  file_id: z.number(),
  link: z.record(z.unknown()).nullable(),
});

const DriveFileAccessListOutput = z.object({
  drive_id: z.number(),
  file_id: z.number(),
  items: z.array(z.unknown()),
  summary_markdown: z.string(),
});

const ConfirmedDriveFileAccessOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      file_id: z.number(),
      scope: z.enum(["users", "teams", "invitations"]),
      action: z.enum(["create", "update", "remove", "invite"]),
      subject_id: z.number().optional(),
    }),
    current_access: z.array(z.unknown()),
    current_entry: z.record(z.unknown()).nullable(),
    payload: z.record(z.unknown()).optional(),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    file_id: z.number(),
    scope: z.enum(["users", "teams", "invitations"]),
    action: z.enum(["create", "update", "remove", "invite"]),
    subject_id: z.number().optional(),
    payload: z.record(z.unknown()).optional(),
    message: z.string(),
  }),
]);

const DriveStatisticsOutput = z.object({
  drive_id: z.number(),
  statistic: DriveStatisticSchema,
  export: z.boolean(),
  endpoint: z.string(),
  data: z.unknown(),
  summary_markdown: z.string(),
});

const ConfirmedDriveTrashOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({ drive_id: z.number() }),
    current_trash_count: z.number(),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    message: z.string(),
  }),
]);

const ConfirmedDriveTrashItemOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      file_id: z.number(),
      action: z.string(),
    }),
    item: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    file_id: z.number(),
    message: z.string(),
  }),
]);

const ConfirmedDriveTrashSettingsOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({ drive_id: z.number() }),
    current_settings: z.record(z.unknown()),
    settings: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    settings: z.record(z.unknown()),
    message: z.string(),
  }),
]);

const ConfirmedDriveShareLinkPayloadOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      file_id: z.number(),
      action: z.string(),
    }),
    current_link: z.record(z.unknown()).nullable(),
    link: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    file_id: z.number(),
    link: z.record(z.unknown()),
    message: z.string(),
  }),
]);

const ConfirmedDriveShareLinkRemoveOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      file_id: z.number(),
      action: z.literal("remove"),
    }),
    current_link: z.record(z.unknown()).nullable(),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    file_id: z.number(),
    message: z.string(),
  }),
]);

const ConfirmedDriveShareLinkInviteOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      file_id: z.number(),
      action: z.literal("invite"),
    }),
    current_link: z.record(z.unknown()).nullable(),
    invitation: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    file_id: z.number(),
    invitation: z.record(z.unknown()),
    message: z.string(),
  }),
]);

type DriveFileAccessScope = "users" | "teams" | "invitations";
type DriveFileAccessAction = "create" | "update" | "remove" | "invite";

type DriveFileAccessPlan = {
  plan: {
    drive_id: number;
    file_id: number;
    scope: DriveFileAccessScope;
    action: DriveFileAccessAction;
    subject_id?: number;
  };
  current_access: unknown[];
  current_entry: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
};

type DriveFileAccessApplied = {
  drive_id: number;
  file_id: number;
  scope: DriveFileAccessScope;
  action: DriveFileAccessAction;
  subject_id?: number;
  payload?: Record<string, unknown>;
  message: string;
};

const ConfirmedDriveUserCreateOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({ drive_id: z.number(), action: z.literal("create") }),
    current_users: z.array(z.unknown()),
    user: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    user: z.record(z.unknown()),
    message: z.string(),
  }),
]);

const ConfirmedDriveUserUpdateOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      user_id: z.number(),
      action: z.literal("update"),
    }),
    current_user: z.record(z.unknown()),
    user: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    user_id: z.number(),
    user: z.record(z.unknown()),
    message: z.string(),
  }),
]);

const ConfirmedDriveUserActionOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      user_id: z.number(),
      action: z.string(),
    }),
    current_user: z.record(z.unknown()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    user_id: z.number(),
    message: z.string(),
  }),
]);

const ConfirmedDriveUserManagerOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      drive_id: z.number(),
      user_id: z.number(),
      action: z.literal("manager"),
    }),
    current_user: z.record(z.unknown()),
    is_manager: z.boolean(),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    drive_id: z.number(),
    user_id: z.number(),
    is_manager: z.boolean(),
    message: z.string(),
  }),
]);

export const auditKdriveAdminTool = defineTool({
  name: "infomaniak_audit_kdrive_admin",
  description:
    "Read-only kDrive admin posture audit: product health, users, external users, public share links, settings, storage usage, and trash count.",
  inputSchema: KdriveAdminAuditInput,
  outputSchema: KdriveAdminAuditOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const storageWarningRatio = input.storage_warning_ratio ?? 0.9;
    const client = new PublicApiClient();
    const [drive, users, shareLinks, settings, trashCountPayload] =
      await Promise.all([
        client.request<unknown>("GET", `/2/drive/${input.drive_id}`, {
          query: { with: "settings,users,invitations_count" },
        }),
        client.request<unknown[]>("GET", `/2/drive/${input.drive_id}/users`),
        client.request<unknown[]>(
          "GET",
          `/3/drive/${input.drive_id}/files/links`,
        ),
        client.request<unknown>("GET", `/2/drive/${input.drive_id}/settings`),
        client.request<unknown>(
          "GET",
          `/2/drive/${input.drive_id}/trash/count`,
        ),
      ]);

    const storageRatio = calculateStorageRatio(drive);
    const adminUsers = users.filter(isAdminUser);
    const externalUsers = users.filter(isExternalUser);
    const riskyShareLinks = shareLinks.filter(isRiskyShareLink);
    const trashItems = readCount(trashCountPayload);
    const findings: Array<z.infer<typeof KdriveFindingSchema>> = [];

    if (
      isTrue(readField(drive, "in_maintenance")) ||
      isTrue(readField(drive, "is_locked"))
    ) {
      findings.push({
        severity: "critical",
        category: "product_state",
        message: "kDrive is locked or in maintenance.",
      });
    }
    if (storageRatio !== null && storageRatio >= storageWarningRatio) {
      findings.push({
        severity: "warning",
        category: "storage_usage",
        message: `Storage usage is ${Math.round(storageRatio * 100)}%.`,
      });
    }
    if (riskyShareLinks.length > 0) {
      findings.push({
        severity: "warning",
        category: "public_share_links",
        message: `${riskyShareLinks.length} share link(s) have no password or no expiry.`,
        count: riskyShareLinks.length,
      });
    }
    if (externalUsers.length > 0) {
      findings.push({
        severity: "info",
        category: "external_users",
        message: `${externalUsers.length} external user(s) have drive access.`,
        count: externalUsers.length,
      });
    }
    if (trashItems > 0) {
      findings.push({
        severity: "info",
        category: "trash",
        message: `${trashItems} item(s) are currently in trash.`,
        count: trashItems,
      });
    }
    if (settingsLooksPermissive(settings)) {
      findings.push({
        severity: "info",
        category: "settings",
        message:
          "Drive settings include permissive sharing or link options. Review policy.",
      });
    }

    const summary = {
      users: users.length,
      admin_users: adminUsers.length,
      external_users: externalUsers.length,
      share_links: shareLinks.length,
      risky_share_links: riskyShareLinks.length,
      trash_items: trashItems,
      storage_ratio: storageRatio,
    };

    return {
      drive_id: input.drive_id,
      ...(readStringField(drive, "name")
        ? { drive_name: readStringField(drive, "name") }
        : {}),
      summary,
      drive,
      settings,
      findings,
      summary_markdown: renderKdriveAuditMarkdown(
        input.drive_id,
        summary,
        findings,
      ),
    };
  },
});

export const listDriveShareLinksTool = defineTool({
  name: "infomaniak_list_drive_share_links",
  description:
    "List all kDrive share links visible to the account for admin exposure review. Read-only.",
  inputSchema: DriveInput,
  outputSchema: DriveShareLinksOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const links = await readDriveShareLinks(input.drive_id);
    return {
      drive_id: input.drive_id,
      links,
      summary_markdown: renderDriveShareLinksMarkdown(input.drive_id, links),
    };
  },
});

export const getDriveShareLinkTool = defineTool({
  name: "infomaniak_get_drive_share_link",
  description:
    "Get the share-link settings for one kDrive file or folder. Read-only; returns null when no share link exists.",
  inputSchema: DriveFileInput,
  outputSchema: DriveShareLinkOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    drive_id: input.drive_id,
    file_id: input.file_id,
    link: await readDriveShareLinkOrNull(input.drive_id, input.file_id),
  }),
});

export const getDriveStatisticsTool = defineTool({
  name: "infomaniak_get_drive_statistics",
  description:
    "Read kDrive admin statistics and export endpoints: storage sizes, activity summaries, user activity, shared-file activity, and share-link activity.",
  inputSchema: DriveStatisticsInput,
  outputSchema: DriveStatisticsOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const endpoint = driveStatisticsPath(
      input.drive_id,
      input.statistic,
      input.export ?? false,
    );
    const client = new PublicApiClient();
    const data = await client.request<unknown>(
      "GET",
      endpoint,
      input.query ? { query: input.query } : {},
    );
    return {
      drive_id: input.drive_id,
      statistic: input.statistic,
      export: input.export ?? false,
      endpoint,
      data,
      summary_markdown: renderDriveStatisticsMarkdown(
        input.drive_id,
        input.statistic,
        endpoint,
      ),
    };
  },
});

export const createDriveShareLinkTool = defineDriveShareLinkPayloadTool({
  name: "infomaniak_create_drive_share_link",
  description:
    "Create a kDrive share link through POST /2/drive/{drive_id}/files/{file_id}/link. Two-phase commit with current share-link guard.",
  action: "create",
  method: "POST",
});

export const updateDriveShareLinkTool = defineDriveShareLinkPayloadTool({
  name: "infomaniak_update_drive_share_link",
  description:
    "Update a kDrive share link through PUT /2/drive/{drive_id}/files/{file_id}/link. Two-phase commit with current share-link guard.",
  action: "update",
  method: "PUT",
});

export const removeDriveShareLinkTool = defineTool({
  name: "infomaniak_remove_drive_share_link",
  description:
    "Remove a kDrive share link through DELETE /2/drive/{drive_id}/files/{file_id}/link. Destructive two-phase commit with current share-link guard.",
  inputSchema: ConfirmableDriveFileInput,
  outputSchema: ConfirmedDriveShareLinkRemoveOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: {
    scope: "admin",
    risk: "destructive",
    confirmationRequired: true,
  },
  handler: createMutationGuardedHandler<
    z.infer<typeof ConfirmableDriveFileInput>,
    Record<string, unknown> | null,
    {
      plan: { drive_id: number; file_id: number; action: "remove" };
      current_link: Record<string, unknown> | null;
    },
    {
      drive_id: number;
      file_id: number;
      message: string;
    }
  >({
    toolName: "infomaniak_remove_drive_share_link",
    loadCurrent: async (input) =>
      readDriveShareLinkOrNull(input.drive_id, input.file_id),
    buildPlan: (input, currentLink) => ({
      plan: {
        drive_id: input.drive_id,
        file_id: input.file_id,
        action: "remove",
      },
      current_link: currentLink,
    }),
    fingerprintPayload: (input, currentLink) => ({
      tool: "infomaniak_remove_drive_share_link",
      drive_id: input.drive_id,
      file_id: input.file_id,
      current_link: currentLink,
    }),
    apply: async (input) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "DELETE",
        driveShareLinkPath(input.drive_id, input.file_id),
      );
      recordHistory({
        tool: "infomaniak_remove_drive_share_link",
        kind: "kdrive_admin",
        summary: `Removed share link for file ${input.file_id} on kDrive ${input.drive_id}`,
        payload: { drive_id: input.drive_id, file_id: input.file_id },
      });
      return {
        drive_id: input.drive_id,
        file_id: input.file_id,
        message: `✅ kDrive share link removed for file ${input.file_id}.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveShareLinkPlanMarkdown(
        "infomaniak_remove_drive_share_link",
        input,
        "remove",
        plan.current_link,
        undefined,
        token,
      ),
  }),
});

export const inviteDriveShareLinkTool = defineTool({
  name: "infomaniak_invite_drive_share_link",
  description:
    "Invite recipients to a kDrive share link through POST /2/drive/{drive_id}/files/{file_id}/link/invite. Two-phase commit with current share-link guard.",
  inputSchema: DriveShareLinkInviteInput,
  outputSchema: ConfirmedDriveShareLinkInviteOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof DriveShareLinkInviteInput>,
    Record<string, unknown> | null,
    {
      plan: { drive_id: number; file_id: number; action: "invite" };
      current_link: Record<string, unknown> | null;
      invitation: Record<string, unknown>;
    },
    {
      drive_id: number;
      file_id: number;
      invitation: Record<string, unknown>;
      message: string;
    }
  >({
    toolName: "infomaniak_invite_drive_share_link",
    loadCurrent: async (input) =>
      readDriveShareLinkOrNull(input.drive_id, input.file_id),
    buildPlan: (input, currentLink) => ({
      plan: {
        drive_id: input.drive_id,
        file_id: input.file_id,
        action: "invite",
      },
      current_link: currentLink,
      invitation: input.invitation,
    }),
    fingerprintPayload: (input, currentLink) => ({
      tool: "infomaniak_invite_drive_share_link",
      drive_id: input.drive_id,
      file_id: input.file_id,
      current_link: currentLink,
      invitation: input.invitation,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "POST",
        `${driveShareLinkPath(input.drive_id, input.file_id)}/invite`,
        { body: plan.invitation },
      );
      recordHistory({
        tool: "infomaniak_invite_drive_share_link",
        kind: "kdrive_admin",
        summary: `Invited recipients to share link for file ${input.file_id} on kDrive ${input.drive_id}`,
        payload: {
          drive_id: input.drive_id,
          file_id: input.file_id,
          invitation: plan.invitation,
        },
      });
      return {
        drive_id: input.drive_id,
        file_id: input.file_id,
        invitation: plan.invitation,
        message: `✅ kDrive share-link invite sent for file ${input.file_id}.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveShareLinkPlanMarkdown(
        "infomaniak_invite_drive_share_link",
        input,
        "invite",
        plan.current_link,
        plan.invitation,
        token,
      ),
  }),
});

export const listDriveFileAccessUsersTool = defineTool({
  name: "infomaniak_list_drive_file_access_users",
  description:
    "List user access entries for a kDrive file or folder. Read-only admin inventory for file permission review.",
  inputSchema: DriveFileAccessListInput,
  outputSchema: DriveFileAccessListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const items = await readDriveFileAccessCollection(
      input.drive_id,
      input.file_id,
      "users",
    );
    return {
      drive_id: input.drive_id,
      file_id: input.file_id,
      items,
      summary_markdown: renderDriveFileAccessListMarkdown(
        input.drive_id,
        input.file_id,
        "users",
        items,
      ),
    };
  },
});

export const listDriveFileAccessTeamsTool = defineTool({
  name: "infomaniak_list_drive_file_access_teams",
  description:
    "List team access entries for a kDrive file or folder. Read-only admin inventory for file permission review.",
  inputSchema: DriveFileAccessListInput,
  outputSchema: DriveFileAccessListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const items = await readDriveFileAccessCollection(
      input.drive_id,
      input.file_id,
      "teams",
    );
    return {
      drive_id: input.drive_id,
      file_id: input.file_id,
      items,
      summary_markdown: renderDriveFileAccessListMarkdown(
        input.drive_id,
        input.file_id,
        "teams",
        items,
      ),
    };
  },
});

export const listDriveFileAccessInvitationsTool = defineTool({
  name: "infomaniak_list_drive_file_access_invitations",
  description:
    "List file-access invitations for a kDrive file or folder. Read-only admin inventory for pending access grants.",
  inputSchema: DriveFileAccessListInput,
  outputSchema: DriveFileAccessListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const items = await readDriveFileAccessCollection(
      input.drive_id,
      input.file_id,
      "invitations",
    );
    return {
      drive_id: input.drive_id,
      file_id: input.file_id,
      items,
      summary_markdown: renderDriveFileAccessListMarkdown(
        input.drive_id,
        input.file_id,
        "invitations",
        items,
      ),
    };
  },
});

export const createDriveFileAccessUserTool = defineDriveFileAccessMutationTool({
  name: "infomaniak_create_drive_file_access_user",
  description:
    "Grant a user access to a kDrive file or folder. Two-phase commit with current file-access guard.",
  inputSchema: DriveFileAccessUserWriteInput,
  scope: "users",
  action: "create",
  method: "POST",
  subjectId: (input) => input.user_id,
  payload: (input) => input.payload,
  readCurrent: async (input) =>
    readDriveFileAccessCollection(input.drive_id, input.file_id, "users"),
  findCurrentEntry: (currentAccess, input) =>
    findDriveFileAccessEntry(currentAccess, "user_id", input.user_id),
  path: (input) =>
    driveFileAccessCollectionPath(input.drive_id, input.file_id, "users"),
  buildBody: (input) => ({ ...input.payload, user_id: input.user_id }),
  message: (input) => `✅ kDrive file access granted to user ${input.user_id}.`,
});

export const updateDriveFileAccessUserTool = defineDriveFileAccessMutationTool({
  name: "infomaniak_update_drive_file_access_user",
  description:
    "Update a user's access role on a kDrive file or folder. Two-phase commit with current file-access guard.",
  inputSchema: DriveFileAccessUserWriteInput,
  scope: "users",
  action: "update",
  method: "PUT",
  subjectId: (input) => input.user_id,
  payload: (input) => input.payload,
  readCurrent: async (input) =>
    readDriveFileAccessCollection(input.drive_id, input.file_id, "users"),
  findCurrentEntry: (currentAccess, input) =>
    findDriveFileAccessEntry(currentAccess, "user_id", input.user_id),
  path: (input) =>
    driveFileAccessItemPath(
      input.drive_id,
      input.file_id,
      "users",
      input.user_id,
    ),
  buildBody: (input) => input.payload,
  message: (input) =>
    `✅ kDrive file access updated for user ${input.user_id}.`,
});

export const removeDriveFileAccessUserTool = defineDriveFileAccessMutationTool({
  name: "infomaniak_remove_drive_file_access_user",
  description:
    "Revoke a user's access to a kDrive file or folder. Destructive two-phase commit with current file-access guard.",
  inputSchema: DriveFileAccessUserRemoveInput,
  scope: "users",
  action: "remove",
  method: "DELETE",
  subjectId: (input) => input.user_id,
  readCurrent: async (input) =>
    readDriveFileAccessCollection(input.drive_id, input.file_id, "users"),
  findCurrentEntry: (currentAccess, input) =>
    findDriveFileAccessEntry(currentAccess, "user_id", input.user_id),
  path: (input) =>
    driveFileAccessItemPath(
      input.drive_id,
      input.file_id,
      "users",
      input.user_id,
    ),
  message: (input) =>
    `✅ kDrive file access removed for user ${input.user_id}.`,
  risk: "destructive",
});

export const createDriveFileAccessTeamTool = defineDriveFileAccessMutationTool({
  name: "infomaniak_create_drive_file_access_team",
  description:
    "Grant a team access to a kDrive file or folder. Two-phase commit with current file-access guard.",
  inputSchema: DriveFileAccessTeamWriteInput,
  scope: "teams",
  action: "create",
  method: "POST",
  subjectId: (input) => input.team_id,
  payload: (input) => input.payload,
  readCurrent: async (input) =>
    readDriveFileAccessCollection(input.drive_id, input.file_id, "teams"),
  findCurrentEntry: (currentAccess, input) =>
    findDriveFileAccessEntry(currentAccess, "team_id", input.team_id),
  path: (input) =>
    driveFileAccessCollectionPath(input.drive_id, input.file_id, "teams"),
  buildBody: (input) => ({ ...input.payload, team_id: input.team_id }),
  message: (input) => `✅ kDrive file access granted to team ${input.team_id}.`,
});

export const updateDriveFileAccessTeamTool = defineDriveFileAccessMutationTool({
  name: "infomaniak_update_drive_file_access_team",
  description:
    "Update a team's access role on a kDrive file or folder. Two-phase commit with current file-access guard.",
  inputSchema: DriveFileAccessTeamWriteInput,
  scope: "teams",
  action: "update",
  method: "PUT",
  subjectId: (input) => input.team_id,
  payload: (input) => input.payload,
  readCurrent: async (input) =>
    readDriveFileAccessCollection(input.drive_id, input.file_id, "teams"),
  findCurrentEntry: (currentAccess, input) =>
    findDriveFileAccessEntry(currentAccess, "team_id", input.team_id),
  path: (input) =>
    driveFileAccessItemPath(
      input.drive_id,
      input.file_id,
      "teams",
      input.team_id,
    ),
  buildBody: (input) => input.payload,
  message: (input) =>
    `✅ kDrive file access updated for team ${input.team_id}.`,
});

export const removeDriveFileAccessTeamTool = defineDriveFileAccessMutationTool({
  name: "infomaniak_remove_drive_file_access_team",
  description:
    "Revoke a team's access to a kDrive file or folder. Destructive two-phase commit with current file-access guard.",
  inputSchema: DriveFileAccessTeamRemoveInput,
  scope: "teams",
  action: "remove",
  method: "DELETE",
  subjectId: (input) => input.team_id,
  readCurrent: async (input) =>
    readDriveFileAccessCollection(input.drive_id, input.file_id, "teams"),
  findCurrentEntry: (currentAccess, input) =>
    findDriveFileAccessEntry(currentAccess, "team_id", input.team_id),
  path: (input) =>
    driveFileAccessItemPath(
      input.drive_id,
      input.file_id,
      "teams",
      input.team_id,
    ),
  message: (input) =>
    `✅ kDrive file access removed for team ${input.team_id}.`,
  risk: "destructive",
});

export const createDriveFileAccessInvitationTool =
  defineDriveFileAccessMutationTool({
    name: "infomaniak_create_drive_file_access_invitation",
    description:
      "Invite a recipient to access a kDrive file or folder. Two-phase commit with current invitation guard.",
    inputSchema: DriveFileAccessInvitationInput,
    scope: "invitations",
    action: "invite",
    method: "POST",
    payload: (input) => input.payload,
    readCurrent: async (input) =>
      readDriveFileAccessCollection(
        input.drive_id,
        input.file_id,
        "invitations",
      ),
    findCurrentEntry: (currentAccess, input) =>
      findDriveFileAccessInvitation(currentAccess, input),
    path: (input) =>
      driveFileAccessCollectionPath(
        input.drive_id,
        input.file_id,
        "invitations",
      ),
    buildBody: (input) => input.payload,
    message: (input) =>
      `✅ kDrive file access invitation sent for file ${input.file_id}.`,
  });

export const emptyDriveTrashTool = defineTool({
  name: "infomaniak_empty_drive_trash",
  description:
    "Empty the entire kDrive trash. Destructive two-phase commit with trash count guard; not undoable.",
  inputSchema: DriveTrashInput,
  outputSchema: ConfirmedDriveTrashOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: {
    scope: "admin",
    risk: "destructive",
    confirmationRequired: true,
  },
  handler: createMutationGuardedHandler<
    z.infer<typeof DriveTrashInput>,
    number,
    { plan: { drive_id: number }; current_trash_count: number },
    { drive_id: number; message: string }
  >({
    toolName: "infomaniak_empty_drive_trash",
    loadCurrent: async (input) => readDriveTrashCount(input.drive_id),
    buildPlan: (input, currentTrashCount) => ({
      plan: { drive_id: input.drive_id },
      current_trash_count: currentTrashCount,
    }),
    fingerprintPayload: (input, currentTrashCount) => ({
      tool: "infomaniak_empty_drive_trash",
      drive_id: input.drive_id,
      current_trash_count: currentTrashCount,
    }),
    apply: async (input) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "DELETE",
        `/2/drive/${input.drive_id}/trash`,
      );
      recordHistory({
        tool: "infomaniak_empty_drive_trash",
        kind: "kdrive_admin",
        summary: `Emptied trash for kDrive ${input.drive_id}`,
        payload: { drive_id: input.drive_id },
      });
      return {
        drive_id: input.drive_id,
        message: `✅ kDrive ${input.drive_id} trash emptied.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveTrashPlanMarkdown(
        input.drive_id,
        plan.current_trash_count,
        token,
      ),
  }),
});

export const createDriveUserTool = defineTool({
  name: "infomaniak_create_drive_user",
  description:
    "Create a kDrive user through POST /2/drive/{drive_id}/users. Two-phase commit with current user-list guard.",
  inputSchema: DriveUserCreateInput,
  outputSchema: ConfirmedDriveUserCreateOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof DriveUserCreateInput>,
    unknown[],
    {
      plan: { drive_id: number; action: "create" };
      current_users: unknown[];
      user: Record<string, unknown>;
    },
    {
      drive_id: number;
      user: Record<string, unknown>;
      message: string;
    }
  >({
    toolName: "infomaniak_create_drive_user",
    loadCurrent: async (input) => readDriveUsers(input.drive_id),
    buildPlan: (input, currentUsers) => ({
      plan: { drive_id: input.drive_id, action: "create" },
      current_users: currentUsers,
      user: input.user,
    }),
    fingerprintPayload: (input, currentUsers) => ({
      tool: "infomaniak_create_drive_user",
      drive_id: input.drive_id,
      current_users: currentUsers,
      user: input.user,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "POST",
        `/2/drive/${input.drive_id}/users`,
        {
          body: plan.user,
        },
      );
      recordHistory({
        tool: "infomaniak_create_drive_user",
        kind: "kdrive_admin",
        summary: `Created kDrive user on drive ${input.drive_id}`,
        payload: { drive_id: input.drive_id, user: plan.user },
      });
      return {
        drive_id: input.drive_id,
        user: plan.user,
        message: `✅ kDrive user created on drive ${input.drive_id}.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveUserCreatePlanMarkdown(
        input.drive_id,
        plan.current_users.length,
        plan.user,
        token,
      ),
  }),
});

export const updateDriveUserTool = defineTool({
  name: "infomaniak_update_drive_user",
  description:
    "Update a kDrive user through PUT /2/drive/{drive_id}/users/{user_id}. Two-phase commit with current user guard.",
  inputSchema: DriveUserUpdateInput,
  outputSchema: ConfirmedDriveUserUpdateOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof DriveUserUpdateInput>,
    Record<string, unknown>,
    {
      plan: { drive_id: number; user_id: number; action: "update" };
      current_user: Record<string, unknown>;
      user: Record<string, unknown>;
    },
    {
      drive_id: number;
      user_id: number;
      user: Record<string, unknown>;
      message: string;
    }
  >({
    toolName: "infomaniak_update_drive_user",
    loadCurrent: async (input) => readDriveUser(input.drive_id, input.user_id),
    buildPlan: (input, currentUser) => ({
      plan: {
        drive_id: input.drive_id,
        user_id: input.user_id,
        action: "update",
      },
      current_user: currentUser,
      user: input.user,
    }),
    fingerprintPayload: (input, currentUser) => ({
      tool: "infomaniak_update_drive_user",
      drive_id: input.drive_id,
      user_id: input.user_id,
      current_user: currentUser,
      user: input.user,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "PUT",
        `/2/drive/${input.drive_id}/users/${input.user_id}`,
        {
          body: plan.user,
        },
      );
      recordHistory({
        tool: "infomaniak_update_drive_user",
        kind: "kdrive_admin",
        summary: `Updated kDrive user ${input.user_id} on drive ${input.drive_id}`,
        payload: {
          drive_id: input.drive_id,
          user_id: input.user_id,
          user: plan.user,
        },
      });
      return {
        drive_id: input.drive_id,
        user_id: input.user_id,
        user: plan.user,
        message: `✅ kDrive user ${input.user_id} updated on drive ${input.drive_id}.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveUserUpdatePlanMarkdown(
        input,
        plan.current_user,
        plan.user,
        token,
      ),
  }),
});

export const deleteDriveUserTool = defineDriveUserActionTool({
  name: "infomaniak_delete_drive_user",
  description:
    "Delete a kDrive user from a drive. Destructive two-phase commit with current user guard.",
  action: "delete",
  method: "DELETE",
  path: (input) => `/2/drive/${input.drive_id}/users/${input.user_id}`,
  message: (input) =>
    `✅ kDrive user ${input.user_id} deleted from drive ${input.drive_id}.`,
  risk: "destructive",
});

export const lockDriveUserTool = defineDriveUserActionTool({
  name: "infomaniak_lock_drive_user",
  description:
    "Lock a kDrive user through POST /2/drive/{drive_id}/users/{user_id}/lock. Two-phase commit with current user guard.",
  action: "lock",
  method: "POST",
  path: (input) => `/2/drive/${input.drive_id}/users/${input.user_id}/lock`,
  message: (input) =>
    `✅ kDrive user ${input.user_id} locked on drive ${input.drive_id}.`,
});

export const unlockDriveUserTool = defineDriveUserActionTool({
  name: "infomaniak_unlock_drive_user",
  description:
    "Unlock a kDrive user through POST /2/drive/{drive_id}/users/{user_id}/unlock. Two-phase commit with current user guard.",
  action: "unlock",
  method: "POST",
  path: (input) => `/2/drive/${input.drive_id}/users/${input.user_id}/unlock`,
  message: (input) =>
    `✅ kDrive user ${input.user_id} unlocked on drive ${input.drive_id}.`,
});

export const setDriveUserManagerTool = defineTool({
  name: "infomaniak_set_drive_user_manager",
  description:
    "Set or remove kDrive manager rights through PATCH /2/drive/{drive_id}/users/{user_id}/manager. Two-phase commit with current user guard.",
  inputSchema: DriveUserManagerInput,
  outputSchema: ConfirmedDriveUserManagerOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof DriveUserManagerInput>,
    Record<string, unknown>,
    {
      plan: { drive_id: number; user_id: number; action: "manager" };
      current_user: Record<string, unknown>;
      is_manager: boolean;
    },
    {
      drive_id: number;
      user_id: number;
      is_manager: boolean;
      message: string;
    }
  >({
    toolName: "infomaniak_set_drive_user_manager",
    loadCurrent: async (input) => readDriveUser(input.drive_id, input.user_id),
    buildPlan: (input, currentUser) => ({
      plan: {
        drive_id: input.drive_id,
        user_id: input.user_id,
        action: "manager",
      },
      current_user: currentUser,
      is_manager: input.is_manager,
    }),
    fingerprintPayload: (input, currentUser) => ({
      tool: "infomaniak_set_drive_user_manager",
      drive_id: input.drive_id,
      user_id: input.user_id,
      current_user: currentUser,
      is_manager: input.is_manager,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "PATCH",
        `/2/drive/${input.drive_id}/users/${input.user_id}/manager`,
        { body: { is_manager: plan.is_manager } },
      );
      recordHistory({
        tool: "infomaniak_set_drive_user_manager",
        kind: "kdrive_admin",
        summary: `Set manager=${plan.is_manager} for kDrive user ${input.user_id} on drive ${input.drive_id}`,
        payload: {
          drive_id: input.drive_id,
          user_id: input.user_id,
          is_manager: plan.is_manager,
        },
      });
      return {
        drive_id: input.drive_id,
        user_id: input.user_id,
        is_manager: plan.is_manager,
        message: `✅ kDrive user ${input.user_id} manager rights set to ${plan.is_manager}.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveUserManagerPlanMarkdown(
        input,
        plan.current_user,
        plan.is_manager,
        token,
      ),
  }),
});

export const restoreDriveTrashItemTool = defineDriveTrashItemTool({
  name: "infomaniak_restore_drive_trash_item",
  description:
    "Restore one file or folder from kDrive trash. Two-phase commit with trashed-item guard.",
  action: "restore",
  method: "POST",
  path: (input) => `/2/drive/${input.drive_id}/trash/${input.file_id}/restore`,
  message: (input) => `✅ kDrive trash item ${input.file_id} restored.`,
});

export const removeDriveTrashItemTool = defineDriveTrashItemTool({
  name: "infomaniak_remove_drive_trash_item",
  description:
    "Permanently remove one file or folder from kDrive trash. Destructive two-phase commit with trashed-item guard; not undoable.",
  action: "remove",
  method: "DELETE",
  path: (input) => `/2/drive/${input.drive_id}/trash/${input.file_id}`,
  message: (input) =>
    `✅ kDrive trash item ${input.file_id} permanently removed.`,
  risk: "destructive",
});

export const updateDriveTrashSettingsTool = defineTool({
  name: "infomaniak_update_drive_trash_settings",
  description:
    "Update kDrive trash settings through PUT /2/drive/{drive_id}/settings/trash. Two-phase commit with current settings guard.",
  inputSchema: DriveTrashSettingsInput,
  outputSchema: ConfirmedDriveTrashSettingsOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof DriveTrashSettingsInput>,
    Record<string, unknown>,
    {
      plan: { drive_id: number };
      current_settings: Record<string, unknown>;
      settings: Record<string, unknown>;
    },
    {
      drive_id: number;
      settings: Record<string, unknown>;
      message: string;
    }
  >({
    toolName: "infomaniak_update_drive_trash_settings",
    loadCurrent: async (input) => readDriveSettings(input.drive_id),
    buildPlan: (input, currentSettings) => ({
      plan: { drive_id: input.drive_id },
      current_settings: currentSettings,
      settings: input.settings,
    }),
    fingerprintPayload: (input, currentSettings) => ({
      tool: "infomaniak_update_drive_trash_settings",
      drive_id: input.drive_id,
      current_settings: currentSettings,
      settings: input.settings,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      await client.request<unknown>(
        "PUT",
        `/2/drive/${input.drive_id}/settings/trash`,
        {
          body: plan.settings,
        },
      );
      recordHistory({
        tool: "infomaniak_update_drive_trash_settings",
        kind: "kdrive_admin",
        summary: `Updated trash settings for kDrive ${input.drive_id}`,
        payload: { drive_id: input.drive_id, settings: plan.settings },
      });
      return {
        drive_id: input.drive_id,
        settings: plan.settings,
        message: `✅ kDrive ${input.drive_id} trash settings updated.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderDriveTrashSettingsPlanMarkdown(
        input.drive_id,
        plan.current_settings,
        plan.settings,
        token,
      ),
  }),
});

function defineDriveTrashItemTool(definition: {
  name: string;
  description: string;
  action: "restore" | "remove";
  method: "POST" | "DELETE";
  path: (input: z.infer<typeof DriveTrashItemInput>) => string;
  message: (input: z.infer<typeof DriveTrashItemInput>) => string;
  risk?: "write" | "destructive";
}): ToolDefinition {
  return defineTool({
    name: definition.name,
    description: definition.description,
    inputSchema: DriveTrashItemInput,
    outputSchema: ConfirmedDriveTrashItemOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    capability: {
      scope: "admin",
      risk: definition.risk ?? "write",
      confirmationRequired: true,
    },
    handler: createMutationGuardedHandler<
      z.infer<typeof DriveTrashItemInput>,
      Record<string, unknown>,
      {
        plan: { drive_id: number; file_id: number; action: string };
        item: Record<string, unknown>;
      },
      {
        drive_id: number;
        file_id: number;
        message: string;
      }
    >({
      toolName: definition.name,
      loadCurrent: async (input) =>
        readDriveTrashItem(input.drive_id, input.file_id),
      buildPlan: (input, item) => ({
        plan: {
          drive_id: input.drive_id,
          file_id: input.file_id,
          action: definition.action,
        },
        item,
      }),
      fingerprintPayload: (input, item) => ({
        tool: definition.name,
        drive_id: input.drive_id,
        file_id: input.file_id,
        action: definition.action,
        item,
      }),
      apply: async (input) => {
        const client = new PublicApiClient();
        await client.request<unknown>(
          definition.method,
          definition.path(input),
        );
        recordHistory({
          tool: definition.name,
          kind: "kdrive_admin",
          summary: `${definition.action} trash item ${input.file_id} on kDrive ${input.drive_id}`,
          payload: {
            drive_id: input.drive_id,
            file_id: input.file_id,
            action: definition.action,
          },
        });
        return {
          drive_id: input.drive_id,
          file_id: input.file_id,
          message: definition.message(input),
        };
      },
      renderPlanMarkdown: (input, plan, token) =>
        renderDriveTrashItemPlanMarkdown(
          definition.name,
          input,
          definition.action,
          plan.item,
          token,
        ),
    }),
  });
}

function defineDriveShareLinkPayloadTool(definition: {
  name: string;
  description: string;
  action: "create" | "update";
  method: "POST" | "PUT";
}): ToolDefinition {
  return defineTool({
    name: definition.name,
    description: definition.description,
    inputSchema: DriveShareLinkPayloadInput,
    outputSchema: ConfirmedDriveShareLinkPayloadOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: definition.action === "update",
      openWorldHint: true,
    },
    capability: { scope: "admin", risk: "write", confirmationRequired: true },
    handler: createMutationGuardedHandler<
      z.infer<typeof DriveShareLinkPayloadInput>,
      Record<string, unknown> | null,
      {
        plan: { drive_id: number; file_id: number; action: string };
        current_link: Record<string, unknown> | null;
        link: Record<string, unknown>;
      },
      {
        drive_id: number;
        file_id: number;
        link: Record<string, unknown>;
        message: string;
      }
    >({
      toolName: definition.name,
      loadCurrent: async (input) =>
        readDriveShareLinkOrNull(input.drive_id, input.file_id),
      buildPlan: (input, currentLink) => ({
        plan: {
          drive_id: input.drive_id,
          file_id: input.file_id,
          action: definition.action,
        },
        current_link: currentLink,
        link: input.link,
      }),
      fingerprintPayload: (input, currentLink) => ({
        tool: definition.name,
        drive_id: input.drive_id,
        file_id: input.file_id,
        action: definition.action,
        current_link: currentLink,
        link: input.link,
      }),
      apply: async (input, plan) => {
        const client = new PublicApiClient();
        await client.request<unknown>(
          definition.method,
          driveShareLinkPath(input.drive_id, input.file_id),
          { body: plan.link },
        );
        recordHistory({
          tool: definition.name,
          kind: "kdrive_admin",
          summary: `${definition.action} share link for file ${input.file_id} on kDrive ${input.drive_id}`,
          payload: {
            drive_id: input.drive_id,
            file_id: input.file_id,
            action: definition.action,
            link: plan.link,
          },
        });
        return {
          drive_id: input.drive_id,
          file_id: input.file_id,
          link: plan.link,
          message: `✅ kDrive share link ${definition.action}d for file ${input.file_id}.`,
        };
      },
      renderPlanMarkdown: (input, plan, token) =>
        renderDriveShareLinkPlanMarkdown(
          definition.name,
          input,
          definition.action,
          plan.current_link,
          plan.link,
          token,
        ),
    }),
  });
}

function defineDriveUserActionTool(definition: {
  name: string;
  description: string;
  action: "delete" | "lock" | "unlock";
  method: "POST" | "DELETE";
  path: (input: z.infer<typeof DriveUserMutationInput>) => string;
  message: (input: z.infer<typeof DriveUserMutationInput>) => string;
  risk?: "write" | "destructive";
}): ToolDefinition {
  return defineTool({
    name: definition.name,
    description: definition.description,
    inputSchema: DriveUserMutationInput,
    outputSchema: ConfirmedDriveUserActionOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: definition.risk === "destructive",
      idempotentHint: definition.action !== "delete",
      openWorldHint: true,
    },
    capability: {
      scope: "admin",
      risk: definition.risk ?? "write",
      confirmationRequired: true,
    },
    handler: createMutationGuardedHandler<
      z.infer<typeof DriveUserMutationInput>,
      Record<string, unknown>,
      {
        plan: { drive_id: number; user_id: number; action: string };
        current_user: Record<string, unknown>;
      },
      {
        drive_id: number;
        user_id: number;
        message: string;
      }
    >({
      toolName: definition.name,
      loadCurrent: async (input) =>
        readDriveUser(input.drive_id, input.user_id),
      buildPlan: (input, currentUser) => ({
        plan: {
          drive_id: input.drive_id,
          user_id: input.user_id,
          action: definition.action,
        },
        current_user: currentUser,
      }),
      fingerprintPayload: (input, currentUser) => ({
        tool: definition.name,
        drive_id: input.drive_id,
        user_id: input.user_id,
        action: definition.action,
        current_user: currentUser,
      }),
      apply: async (input) => {
        const client = new PublicApiClient();
        await client.request<unknown>(
          definition.method,
          definition.path(input),
        );
        recordHistory({
          tool: definition.name,
          kind: "kdrive_admin",
          summary: `${definition.action} kDrive user ${input.user_id} on drive ${input.drive_id}`,
          payload: {
            drive_id: input.drive_id,
            user_id: input.user_id,
            action: definition.action,
          },
        });
        return {
          drive_id: input.drive_id,
          user_id: input.user_id,
          message: definition.message(input),
        };
      },
      renderPlanMarkdown: (input, plan, token) =>
        renderDriveUserActionPlanMarkdown(
          definition.name,
          input,
          definition.action,
          plan.current_user,
          token,
        ),
    }),
  });
}

async function readDriveShareLinks(driveId: number): Promise<unknown[]> {
  const client = new PublicApiClient();
  const links = await client.request<unknown>(
    "GET",
    `/3/drive/${driveId}/files/links`,
  );
  return readArrayPayload(links);
}

async function readDriveShareLinkOrNull(
  driveId: number,
  fileId: number,
): Promise<Record<string, unknown> | null> {
  const client = new PublicApiClient();
  try {
    const link = await client.request<unknown>(
      "GET",
      driveShareLinkPath(driveId, fileId),
    );
    if (link === null || link === undefined) {
      return null;
    }
    return isRecord(link) ? link : { value: link };
  } catch (error) {
    if (error instanceof InfomaniakNotFoundError) {
      return null;
    }
    throw error;
  }
}

async function readDriveUsers(driveId: number): Promise<unknown[]> {
  const client = new PublicApiClient();
  const users = await client.request<unknown>(
    "GET",
    `/2/drive/${driveId}/users`,
  );
  return readArrayPayload(users);
}

async function readDriveUser(
  driveId: number,
  userId: number,
): Promise<Record<string, unknown>> {
  const client = new PublicApiClient();
  const user = await client.request<unknown>(
    "GET",
    `/2/drive/${driveId}/users/${userId}`,
  );
  return isRecord(user) ? user : { value: user };
}

async function readDriveTrashCount(driveId: number): Promise<number> {
  const client = new PublicApiClient();
  return readCount(
    await client.request<unknown>("GET", `/2/drive/${driveId}/trash/count`),
  );
}

async function readDriveTrashItem(
  driveId: number,
  fileId: number,
): Promise<Record<string, unknown>> {
  const client = new PublicApiClient();
  const item = await client.request<unknown>(
    "GET",
    `/3/drive/${driveId}/trash/${fileId}`,
  );
  return isRecord(item) ? item : { value: item };
}

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

function renderDriveTrashPlanMarkdown(
  driveId: number,
  currentTrashCount: number,
  token: string,
): string {
  return [
    `## Plan — empty kDrive trash`,
    ``,
    `- **kDrive**: ${driveId}`,
    `- **Current trash items**: ${currentTrashCount}`,
    `- **Endpoint**: \`DELETE /2/drive/${driveId}/trash\``,
    ``,
    `### Impact`,
    `This permanently deletes every item currently in the kDrive trash. The MCP cannot undo this operation.`,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_empty_drive_trash\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveTrashItemPlanMarkdown(
  toolName: string,
  input: z.infer<typeof DriveTrashItemInput>,
  action: "restore" | "remove",
  item: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — ${action} kDrive trash item`,
    ``,
    `- **kDrive**: ${input.drive_id}`,
    `- **File/folder id**: ${input.file_id}`,
    `- **Item name**: \`${readStringField(item, "name") ?? "(unknown)"}\``,
    ``,
    `### Current-state guard`,
    `The current trash item details were prefetched and are part of the confirmation token. Re-plan if another admin changes this item before apply.`,
    ``,
    `### Next step`,
    `Re-call \`${toolName}\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveTrashSettingsPlanMarkdown(
  driveId: number,
  currentSettings: Record<string, unknown>,
  settings: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — update kDrive trash settings`,
    ``,
    `- **kDrive**: ${driveId}`,
    `- **Current settings snapshot**: \`${JSON.stringify(currentSettings)}\``,
    `- **Requested trash settings**: \`${JSON.stringify(settings)}\``,
    `- **Endpoint**: \`PUT /2/drive/${driveId}/settings/trash\``,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_update_drive_trash_settings\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveShareLinksMarkdown(
  driveId: number,
  links: unknown[],
): string {
  return [
    `# kDrive share links — drive ${driveId}`,
    ``,
    `- Share links: ${links.length}`,
  ].join("\n");
}

function renderDriveStatisticsMarkdown(
  driveId: number,
  statistic: z.infer<typeof DriveStatisticSchema>,
  endpoint: string,
): string {
  return [
    `# kDrive statistics — drive ${driveId}`,
    ``,
    `- Statistic: ${statistic}`,
    `- Endpoint: \`${endpoint}\``,
  ].join("\n");
}

function driveFileAccessCollectionPath(
  driveId: number,
  fileId: number,
  scope: DriveFileAccessScope,
): string {
  return `/2/drive/${driveId}/files/${fileId}/access/${scope}`;
}

function driveFileAccessItemPath(
  driveId: number,
  fileId: number,
  scope: Exclude<DriveFileAccessScope, "invitations">,
  subjectId: number,
): string {
  return `${driveFileAccessCollectionPath(driveId, fileId, scope)}/${subjectId}`;
}

function driveFileAccessPathForPlan(plan: DriveFileAccessPlan): string {
  if (plan.plan.action === "create" || plan.plan.action === "invite") {
    return driveFileAccessCollectionPath(
      plan.plan.drive_id,
      plan.plan.file_id,
      plan.plan.scope,
    );
  }
  if (plan.plan.subject_id === undefined) {
    return driveFileAccessCollectionPath(
      plan.plan.drive_id,
      plan.plan.file_id,
      plan.plan.scope,
    );
  }
  return driveFileAccessItemPath(
    plan.plan.drive_id,
    plan.plan.file_id,
    plan.plan.scope as Exclude<DriveFileAccessScope, "invitations">,
    plan.plan.subject_id,
  );
}

async function readDriveFileAccessCollection(
  driveId: number,
  fileId: number,
  scope: DriveFileAccessScope,
): Promise<unknown[]> {
  const client = new PublicApiClient();
  const items = await client.request<unknown>(
    "GET",
    driveFileAccessCollectionPath(driveId, fileId, scope),
  );
  return readArrayPayload(items);
}

function findDriveFileAccessEntry(
  items: ReadonlyArray<unknown>,
  field: "user_id" | "team_id",
  value: number,
): Record<string, unknown> | null {
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const candidate = item[field];
    if (candidate === value) {
      return item;
    }
    if (
      typeof candidate === "string" &&
      /^\d+$/u.test(candidate) &&
      Number(candidate) === value
    ) {
      return item;
    }
  }
  return null;
}

function findDriveFileAccessInvitation(
  items: ReadonlyArray<unknown>,
  input: z.infer<typeof DriveFileAccessInvitationInput>,
): Record<string, unknown> | null {
  const email = findEmailInPayload(input.payload);
  if (!email) {
    return null;
  }
  for (const item of items) {
    if (!isRecord(item)) {
      continue;
    }
    const candidateEmail =
      readStringField(item, "email") ??
      readStringField(item, "user_email") ??
      readStringField(item, "recipient_email") ??
      readStringField(item, "recipient");
    if (candidateEmail === email) {
      return item;
    }
  }
  return null;
}

function findEmailInPayload(
  payload: Record<string, unknown>,
): string | undefined {
  const direct = readStringField(payload, "email");
  if (direct) {
    return direct;
  }
  const recipientEmail = readStringField(payload, "recipient_email");
  if (recipientEmail) {
    return recipientEmail;
  }
  const recipients = payload["emails"];
  if (Array.isArray(recipients) && recipients.length > 0) {
    const first = recipients[0];
    return typeof first === "string" && first.length > 0 ? first : undefined;
  }
  return undefined;
}

function renderDriveShareLinkPlanMarkdown(
  toolName: string,
  input: z.infer<typeof ConfirmableDriveFileInput>,
  action: "create" | "update" | "remove" | "invite",
  currentLink: Record<string, unknown> | null,
  payload: Record<string, unknown> | undefined,
  token: string,
): string {
  return [
    `## Plan — ${action} kDrive share link`,
    ``,
    `- **kDrive**: ${input.drive_id}`,
    `- **File/folder id**: ${input.file_id}`,
    `- **Current share link**: \`${JSON.stringify(currentLink)}\``,
    ...(payload
      ? [`- **Requested payload**: \`${JSON.stringify(payload)}\``]
      : []),
    ``,
    `### Current-state guard`,
    `The current share-link state was prefetched and is part of the confirmation token. Re-plan if another admin changes this link before apply.`,
    ``,
    `### Next step`,
    `Re-call \`${toolName}\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveFileAccessListMarkdown(
  driveId: number,
  fileId: number,
  scope: DriveFileAccessScope,
  items: ReadonlyArray<unknown>,
): string {
  return [
    `# kDrive file access — ${scope}`,
    ``,
    `- **kDrive**: ${driveId}`,
    `- **File/folder id**: ${fileId}`,
    `- **Entries**: ${items.length}`,
  ].join("\n");
}

function renderDriveFileAccessPlanMarkdown(
  toolName: string,
  input: z.infer<typeof ConfirmableDriveFileInput>,
  plan: DriveFileAccessPlan,
  token: string,
): string {
  return [
    `## Plan — ${plan.plan.action} kDrive file access`,
    ``,
    `- **kDrive**: ${input.drive_id}`,
    `- **File/folder id**: ${input.file_id}`,
    `- **Scope**: ${plan.plan.scope}`,
    ...(plan.plan.subject_id !== undefined
      ? [`- **Subject id**: ${plan.plan.subject_id}`]
      : []),
    `- **Current access entries**: ${plan.current_access.length}`,
    `- **Current entry**: \`${JSON.stringify(plan.current_entry)}\``,
    ...(plan.payload
      ? [`- **Requested payload**: \`${JSON.stringify(plan.payload)}\``]
      : []),
    `- **Endpoint**: \`${driveFileAccessPathForPlan(plan)}\``,
    ``,
    `### Current-state guard`,
    `The current file-access inventory was prefetched and is part of the confirmation token. Re-plan if another admin changes access before apply.`,
    ``,
    `### Next step`,
    `Re-call \`${toolName}\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveUserCreatePlanMarkdown(
  driveId: number,
  currentUserCount: number,
  user: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — create kDrive user`,
    ``,
    `- **kDrive**: ${driveId}`,
    `- **Current user count**: ${currentUserCount}`,
    `- **Requested user payload**: \`${JSON.stringify(user)}\``,
    `- **Endpoint**: \`POST /2/drive/${driveId}/users\``,
    ``,
    `### Current-state guard`,
    `The current drive user list was prefetched and is part of the confirmation token. Re-plan if another admin changes users before apply.`,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_create_drive_user\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveUserUpdatePlanMarkdown(
  input: z.infer<typeof DriveUserUpdateInput>,
  currentUser: Record<string, unknown>,
  user: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — update kDrive user`,
    ``,
    `- **kDrive**: ${input.drive_id}`,
    `- **User id**: ${input.user_id}`,
    `- **Current user snapshot**: \`${JSON.stringify(currentUser)}\``,
    `- **Requested user payload**: \`${JSON.stringify(user)}\``,
    `- **Endpoint**: \`PUT /2/drive/${input.drive_id}/users/${input.user_id}\``,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_update_drive_user\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveUserActionPlanMarkdown(
  toolName: string,
  input: z.infer<typeof DriveUserMutationInput>,
  action: "delete" | "lock" | "unlock",
  currentUser: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — ${action} kDrive user`,
    ``,
    `- **kDrive**: ${input.drive_id}`,
    `- **User id**: ${input.user_id}`,
    `- **Current user snapshot**: \`${JSON.stringify(currentUser)}\``,
    ``,
    `### Current-state guard`,
    `The current user details were prefetched and are part of the confirmation token. Re-plan if another admin changes this user before apply.`,
    ``,
    `### Next step`,
    `Re-call \`${toolName}\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderDriveUserManagerPlanMarkdown(
  input: z.infer<typeof DriveUserManagerInput>,
  currentUser: Record<string, unknown>,
  isManager: boolean,
  token: string,
): string {
  return [
    `## Plan — update kDrive manager rights`,
    ``,
    `- **kDrive**: ${input.drive_id}`,
    `- **User id**: ${input.user_id}`,
    `- **Current user snapshot**: \`${JSON.stringify(currentUser)}\``,
    `- **Requested manager right**: ${isManager}`,
    `- **Endpoint**: \`PATCH /2/drive/${input.drive_id}/users/${input.user_id}/manager\``,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_set_drive_user_manager\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function defineDriveFileAccessMutationTool<
  TInput extends z.ZodTypeAny,
>(definition: {
  name: string;
  description: string;
  inputSchema: TInput;
  scope: DriveFileAccessScope;
  action: DriveFileAccessAction;
  method: "POST" | "PUT" | "DELETE";
  readCurrent: (input: z.infer<TInput>) => Promise<unknown[]>;
  findCurrentEntry: (
    currentAccess: ReadonlyArray<unknown>,
    input: z.infer<TInput>,
  ) => Record<string, unknown> | null;
  path: (input: z.infer<TInput>) => string;
  buildBody?: (
    input: z.infer<TInput>,
    plan: DriveFileAccessPlan,
  ) => Record<string, unknown> | undefined;
  subjectId?: (input: z.infer<TInput>) => number | undefined;
  payload?: (input: z.infer<TInput>) => Record<string, unknown> | undefined;
  message: (input: z.infer<TInput>, plan: DriveFileAccessPlan) => string;
  risk?: "write" | "destructive";
}): ToolDefinition {
  return defineTool({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: ConfirmedDriveFileAccessOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: definition.risk === "destructive",
      idempotentHint:
        definition.action === "update" || definition.action === "remove",
      openWorldHint: true,
    },
    capability: {
      scope: "admin",
      risk:
        definition.risk ??
        (definition.action === "remove" ? "destructive" : "write"),
      confirmationRequired: true,
    },
    handler: createMutationGuardedHandler<
      z.infer<TInput>,
      unknown[],
      DriveFileAccessPlan,
      DriveFileAccessApplied
    >({
      toolName: definition.name,
      loadCurrent: async (input) => definition.readCurrent(input),
      buildPlan: (input, currentAccess) => {
        const currentEntry = definition.findCurrentEntry(currentAccess, input);
        const payload = definition.payload?.(input);
        const subjectId = definition.subjectId?.(input);
        return {
          plan: {
            drive_id: input.drive_id,
            file_id: input.file_id,
            scope: definition.scope,
            action: definition.action,
            ...(subjectId !== undefined ? { subject_id: subjectId } : {}),
          },
          current_access: currentAccess,
          current_entry: currentEntry,
          ...(payload ? { payload } : {}),
        };
      },
      fingerprintPayload: (input, currentAccess, plan) => ({
        tool: definition.name,
        drive_id: input.drive_id,
        file_id: input.file_id,
        scope: definition.scope,
        action: definition.action,
        plan: plan.plan,
        current_access: currentAccess,
        current_entry: plan.current_entry,
        ...(plan.payload ? { payload: plan.payload } : {}),
      }),
      apply: async (input, plan, currentAccess) => {
        const client = new PublicApiClient();
        const body = definition.buildBody?.(input, plan);
        await client.request<unknown>(
          definition.method,
          definition.path(input),
          body ? { body } : {},
        );
        recordHistory({
          tool: definition.name,
          kind: "kdrive_admin",
          summary: `${definition.action} kDrive file access on file ${input.file_id} (${definition.scope})`,
          payload: {
            drive_id: input.drive_id,
            file_id: input.file_id,
            scope: definition.scope,
            action: definition.action,
            subject_id: plan.plan.subject_id,
            current_entry: plan.current_entry,
            current_access_count: currentAccess.length,
            ...(plan.payload ? { payload: plan.payload } : {}),
          },
        });
        return {
          drive_id: input.drive_id,
          file_id: input.file_id,
          scope: definition.scope,
          action: definition.action,
          ...(plan.plan.subject_id !== undefined
            ? { subject_id: plan.plan.subject_id }
            : {}),
          ...(plan.payload ? { payload: plan.payload } : {}),
          message: definition.message(input, plan),
        };
      },
      renderPlanMarkdown: (input, plan, token) =>
        renderDriveFileAccessPlanMarkdown(definition.name, input, plan, token),
    }),
  });
}

function calculateStorageRatio(drive: unknown): number | null {
  const size = readNumberField(drive, "size");
  const usedSize = readNumberField(drive, "used_size");
  if (size === null || usedSize === null || size <= 0) {
    return null;
  }
  return usedSize / size;
}

function isAdminUser(user: unknown): boolean {
  const text = JSON.stringify(user).toLowerCase();
  return /\b(admin|administrator|manager|owner)\b/u.test(text);
}

function isExternalUser(user: unknown): boolean {
  const text = JSON.stringify(user).toLowerCase();
  return text.includes("external") || text.includes('"is_external":true');
}

function isRiskyShareLink(link: unknown): boolean {
  const password = readField(link, "password");
  const expireAt =
    readField(link, "expire_at") ?? readField(link, "expired_at");
  return (
    password === false ||
    password === null ||
    password === undefined ||
    expireAt === null
  );
}

function settingsLooksPermissive(settings: unknown): boolean {
  if (!isRecord(settings)) {
    return false;
  }
  const text = JSON.stringify(settings).toLowerCase();
  return (
    text.includes('"public_share_links":true') ||
    text.includes('"share_link":true') ||
    text.includes('"external_sharing":true')
  );
}

function readCount(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  return (
    readNumberField(value, "count") ?? readNumberField(value, "total") ?? 0
  );
}

function readArrayPayload(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value["data"])) {
    return value["data"];
  }
  return [];
}

function readNumberField(value: unknown, key: string): number | null {
  const field = readField(value, key);
  return typeof field === "number" ? field : null;
}

function readStringField(value: unknown, key: string): string | undefined {
  const field = readField(value, key);
  return typeof field === "string" && field.length > 0 ? field : undefined;
}

function readField(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return value[key];
}

function isTrue(value: unknown): boolean {
  return value === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function driveShareLinkPath(driveId: number, fileId: number): string {
  return `/2/drive/${driveId}/files/${fileId}/link`;
}

function driveStatisticsPath(
  driveId: number,
  statistic: z.infer<typeof DriveStatisticSchema>,
  useExport: boolean,
): string {
  if (statistic === "sizes") {
    return `/2/drive/${driveId}/statistics/sizes${useExport ? "/export" : ""}`;
  }
  if (statistic === "activities") {
    return `/2/drive/${driveId}/statistics/activities${useExport ? "/export" : ""}`;
  }
  if (statistic === "share_links") {
    return `/2/drive/${driveId}/statistics/activities/links${useExport ? "/export" : ""}`;
  }
  if (useExport) {
    throw new Error(
      `Export is not available for kDrive statistic "${statistic}".`,
    );
  }
  if (statistic === "activities_users") {
    return `/2/drive/${driveId}/statistics/activities/users`;
  }
  return `/2/drive/${driveId}/statistics/activities/shared_files`;
}

function renderKdriveAuditMarkdown(
  driveId: number,
  summary: z.infer<typeof KdriveAdminAuditOutput>["summary"],
  findings: ReadonlyArray<z.infer<typeof KdriveFindingSchema>>,
): string {
  return [
    `# kDrive admin audit — drive ${driveId}`,
    ``,
    `- Users: ${summary.users} (${summary.admin_users} admin, ${summary.external_users} external)`,
    `- Share links: ${summary.share_links} (${summary.risky_share_links} risky)`,
    `- Trash items: ${summary.trash_items}`,
    `- Storage usage: ${
      summary.storage_ratio === null
        ? "unknown"
        : `${Math.round(summary.storage_ratio * 100)}%`
    }`,
    ``,
    ...findings.map(
      (finding) =>
        `- ${finding.severity.toUpperCase()} ${finding.category}: ${finding.message}`,
    ),
  ].join("\n");
}
