import { z } from "zod";

import { PublicApiClient, type HttpMethod } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const AccountInvitationInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .describe("Infomaniak account/organization ID."),
  invitation_id: z.number().int().positive().describe("Invitation identifier."),
});

const InvitationSnapshotSchema = z.record(z.unknown());

const GetAccountInvitationAccessOutput = z.object({
  account_id: z.number(),
  invitation_id: z.number(),
  invitation: InvitationSnapshotSchema,
  summary_markdown: z.string(),
});

const InvitationAccessTargetSchema = z.enum([
  "ksuite",
  "drive",
  "mailbox",
  "kchat",
]);
const InvitationAccessActionSchema = z.enum([
  "create",
  "update",
  "delete",
  "invite",
]);

const ManageAccountInvitationAccessInput = AccountInvitationInput.extend({
  target: InvitationAccessTargetSchema,
  action: InvitationAccessActionSchema,
  drive_id: z.number().int().positive().optional(),
  mail_id: z.number().int().positive().optional(),
  payload: z.record(z.unknown()).optional(),
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if (input.target === "ksuite") {
    if (input.action !== "create" && input.action !== "delete") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "kSuite access only supports create or delete actions.",
        path: ["action"],
      });
    }
    return;
  }

  if (input.target === "drive") {
    if (input.drive_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "drive_id is required for drive access actions.",
        path: ["drive_id"],
      });
    }
    if (!["create", "update", "delete"].includes(input.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Drive access only supports create, update, or delete actions.",
        path: ["action"],
      });
    }
    return;
  }

  if (input.target === "mailbox") {
    if (input.action !== "invite" && input.mail_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "mail_id is required for mailbox access actions other than invite.",
        path: ["mail_id"],
      });
    }
    if (!["create", "update", "delete", "invite"].includes(input.action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Mailbox access only supports create, update, delete, or invite actions.",
        path: ["action"],
      });
    }
    return;
  }

  if (input.target === "kchat" && input.action !== "update") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "kChat invitation access only supports the update action.",
      path: ["action"],
    });
  }
});

const ConfirmedAccountInvitationAccessOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      account_id: z.number(),
      invitation_id: z.number(),
      target: InvitationAccessTargetSchema,
      action: InvitationAccessActionSchema,
      drive_id: z.number().optional(),
      mail_id: z.number().optional(),
    }),
    current_invitation: InvitationSnapshotSchema,
    payload: z.record(z.unknown()).optional(),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    account_id: z.number(),
    invitation_id: z.number(),
    target: InvitationAccessTargetSchema,
    action: InvitationAccessActionSchema,
    drive_id: z.number().optional(),
    mail_id: z.number().optional(),
    payload: z.record(z.unknown()).optional(),
    message: z.string(),
  }),
]);

export const getAccountInvitationAccessTool = defineTool({
  name: "infomaniak_get_account_invitation_access",
  description:
    "Inspect a single account invitation and its current access snapshot before granting or revoking kSuite, drive, mailbox, or kChat access.",
  inputSchema: AccountInvitationInput,
  outputSchema: GetAccountInvitationAccessOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const invitation = await readAccountInvitation(
      input.account_id,
      input.invitation_id,
    );
    return {
      account_id: input.account_id,
      invitation_id: input.invitation_id,
      invitation,
      summary_markdown: renderAccountInvitationReadMarkdown(
        input.account_id,
        input.invitation_id,
        invitation,
      ),
    };
  },
});

export const manageAccountInvitationAccessTool = defineTool({
  name: "infomaniak_manage_account_invitation_access",
  description:
    "Grant, update, invite, or revoke invitation-scoped product access for kSuite, drive, mailbox, or kChat. Two-phase confirmation with a fresh invitation snapshot guard.",
  inputSchema: ManageAccountInvitationAccessInput,
  outputSchema: ConfirmedAccountInvitationAccessOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "write", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof ManageAccountInvitationAccessInput>,
    Record<string, unknown>,
    {
      plan: {
        account_id: number;
        invitation_id: number;
        target: z.infer<typeof InvitationAccessTargetSchema>;
        action: z.infer<typeof InvitationAccessActionSchema>;
        drive_id?: number;
        mail_id?: number;
      };
      current_invitation: Record<string, unknown>;
      payload?: Record<string, unknown>;
    },
    {
      account_id: number;
      invitation_id: number;
      target: z.infer<typeof InvitationAccessTargetSchema>;
      action: z.infer<typeof InvitationAccessActionSchema>;
      drive_id?: number;
      mail_id?: number;
      payload?: Record<string, unknown>;
      message: string;
    }
  >({
    toolName: "infomaniak_manage_account_invitation_access",
    loadCurrent: async (input) =>
      readAccountInvitation(input.account_id, input.invitation_id),
    buildPlan: (input, currentInvitation) => {
      const plan = {
        account_id: input.account_id,
        invitation_id: input.invitation_id,
        target: input.target,
        action: input.action,
        ...(input.drive_id !== undefined ? { drive_id: input.drive_id } : {}),
        ...(input.mail_id !== undefined ? { mail_id: input.mail_id } : {}),
      } as const;
      return {
        plan,
        current_invitation: currentInvitation,
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      };
    },
    fingerprintPayload: (input, currentInvitation, plan) => ({
      tool: "infomaniak_manage_account_invitation_access",
      account_id: input.account_id,
      invitation_id: input.invitation_id,
      target: input.target,
      action: input.action,
      ...(input.drive_id !== undefined ? { drive_id: input.drive_id } : {}),
      ...(input.mail_id !== undefined ? { mail_id: input.mail_id } : {}),
      current_invitation: currentInvitation,
      plan,
      ...(input.payload !== undefined ? { payload: input.payload } : {}),
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      const { method, path, body } = buildInvitationAccessMutation(input, plan);
      await client.request<unknown>(method, path, body ? { body } : {});
      recordHistory({
        tool: "infomaniak_manage_account_invitation_access",
        kind: "account_admin",
        summary: `${input.target} invitation access ${input.action} on account ${input.account_id}`,
        payload: {
          account_id: input.account_id,
          invitation_id: input.invitation_id,
          target: input.target,
          action: input.action,
          ...(input.drive_id !== undefined ? { drive_id: input.drive_id } : {}),
          ...(input.mail_id !== undefined ? { mail_id: input.mail_id } : {}),
          ...(input.payload !== undefined ? { payload: input.payload } : {}),
        },
      });
      return {
        account_id: input.account_id,
        invitation_id: input.invitation_id,
        target: input.target,
        action: input.action,
        ...(input.drive_id !== undefined ? { drive_id: input.drive_id } : {}),
        ...(input.mail_id !== undefined ? { mail_id: input.mail_id } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
        message: `✅ ${input.target} invitation access ${input.action}.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderAccountInvitationAccessPlanMarkdown(
        input,
        plan.current_invitation,
        token,
      ),
  }),
});

async function readAccountInvitation(
  accountId: number,
  invitationId: number,
): Promise<Record<string, unknown>> {
  const client = new PublicApiClient();
  const invitation = await client.request<unknown>(
    "GET",
    `/1/accounts/${accountId}/invitations/${invitationId}`,
  );
  return isRecord(invitation) ? invitation : { value: invitation };
}

function buildInvitationAccessMutation(
  input: z.infer<typeof ManageAccountInvitationAccessInput>,
  plan: {
    plan: {
      account_id: number;
      invitation_id: number;
      target: z.infer<typeof InvitationAccessTargetSchema>;
      action: z.infer<typeof InvitationAccessActionSchema>;
      drive_id?: number;
      mail_id?: number;
    };
    current_invitation: Record<string, unknown>;
    payload?: Record<string, unknown>;
  },
): { method: HttpMethod; path: string; body?: Record<string, unknown> } {
  const basePath = `/1/accounts/${input.account_id}/invitations/${input.invitation_id}`;
  const payload = plan.payload ?? input.payload;
  switch (input.target) {
    case "ksuite":
      if (input.action === "create") {
        return {
          method: "POST",
          path: `${basePath}/ksuite`,
          body: payload ?? {},
        };
      }
      return { method: "DELETE", path: `${basePath}/ksuite` };
    case "drive":
      if (input.action === "create") {
        return {
          method: "POST",
          path: `${basePath}/drive`,
          body: { drive_id: requireDriveId(input), ...(payload ?? {}) },
        };
      }
      if (input.action === "update") {
        return {
          method: "PATCH",
          path: `${basePath}/drive/${requireDriveId(input)}`,
          body: payload ?? {},
        };
      }
      return {
        method: "DELETE",
        path: `${basePath}/drive/${requireDriveId(input)}`,
      };
    case "mailbox":
      if (input.action === "invite") {
        return {
          method: "POST",
          path: `${basePath}/mailbox/invite`,
          body: payload ?? {},
        };
      }
      if (input.action === "create") {
        return {
          method: "POST",
          path: `${basePath}/mailbox/${requireMailId(input)}`,
          body: { mail_id: requireMailId(input), ...(payload ?? {}) },
        };
      }
      if (input.action === "update") {
        return {
          method: "PATCH",
          path: `${basePath}/mailbox/${requireMailId(input)}`,
          body: payload ?? {},
        };
      }
      return {
        method: "DELETE",
        path: `${basePath}/mailbox/${requireMailId(input)}`,
      };
    case "kchat":
      return {
        method: "PATCH",
        path: `${basePath}/kchat`,
        body: payload ?? {},
      };
    default:
      throw new Error(`Unsupported invitation access target: ${input.target}`);
  }
}

function requireDriveId(input: { drive_id?: number | undefined }): number {
  if (input.drive_id === undefined || input.drive_id === null) {
    throw new Error("drive_id is required for drive invitation access actions");
  }
  return input.drive_id;
}

function requireMailId(input: { mail_id?: number | undefined }): number {
  if (input.mail_id === undefined || input.mail_id === null) {
    throw new Error(
      "mail_id is required for mailbox invitation access actions",
    );
  }
  return input.mail_id;
}

function renderAccountInvitationReadMarkdown(
  accountId: number,
  invitationId: number,
  invitation: Record<string, unknown>,
): string {
  return [
    `# Account invitation access`,
    ``,
    `- **Account**: ${accountId}`,
    `- **Invitation**: ${invitationId}`,
    `- **Snapshot keys**: ${Object.keys(invitation).slice(0, 20).join(", ") || "(none)"}`,
    ``,
    `Use \`infomaniak_manage_account_invitation_access\` to change kSuite, drive, mailbox, or kChat access after confirming the snapshot.`,
  ].join("\n");
}

function renderAccountInvitationAccessPlanMarkdown(
  input: z.infer<typeof ManageAccountInvitationAccessInput>,
  currentInvitation: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan - manage account invitation access`,
    ``,
    `- **Account**: ${input.account_id}`,
    `- **Invitation**: ${input.invitation_id}`,
    `- **Target**: ${input.target}`,
    `- **Action**: ${input.action}`,
    ...(input.drive_id !== undefined
      ? [`- **Drive id**: ${input.drive_id}`]
      : []),
    ...(input.mail_id !== undefined
      ? [`- **Mailbox id**: ${input.mail_id}`]
      : []),
    input.payload !== undefined
      ? `- **Payload**: \`${JSON.stringify(input.payload)}\``
      : "",
    `- **Current invitation snapshot**: \`${JSON.stringify(currentInvitation)}\``,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_manage_account_invitation_access\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
