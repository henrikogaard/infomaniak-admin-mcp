import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const AccountUserInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .describe("Infomaniak account/organization ID."),
});

const AccountUserAccessInput = AccountUserInput.extend({
  user_id: z.number().int().positive().describe("Infomaniak account user ID."),
});

const AuditAccountAccessInput = AccountUserInput.extend({
  max_users: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(50)
    .describe(
      "Maximum number of account users to inspect. Each user costs one API call.",
    ),
});

const CancelPendingInvitationsInput = AccountUserAccessInput.extend({
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token returned by the plan phase. Required to apply cancellations.",
    ),
});

const ListAccountUsersOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  users: z.array(z.unknown()),
});

const UserAppAccessesOutput = z.object({
  account_id: z.number(),
  user_id: z.number(),
  count: z.number(),
  app_accesses: z.array(z.unknown()),
});

const UserOffboardingPlanOutput = z.object({
  status: z.literal("plan"),
  account_id: z.number(),
  user_id: z.number(),
  app_accesses: z.array(z.unknown()),
  invitations: z.array(z.unknown()),
  actions: z.array(
    z.object({
      action: z.string(),
      reason: z.string(),
    }),
  ),
});

const AccountAccessFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  category: z.string(),
  message: z.string(),
  user_id: z.number().optional(),
  user_email: z.string().optional(),
  app: z.string().optional(),
});

const AccountAccessAuditOutput = z.object({
  account_id: z.number(),
  scanned_users: z.number(),
  summary: z.object({
    users: z.number(),
    app_accesses: z.number(),
    privileged_users: z.number(),
    errors: z.number(),
  }),
  users: z.array(
    z.object({
      user_id: z.number(),
      email: z.string().optional(),
      app_access_count: z.number(),
      privileged_access_count: z.number(),
      fetch_error: z.string().optional(),
    }),
  ),
  findings: z.array(AccountAccessFindingSchema),
  summary_markdown: z.string(),
});

const PendingInvitationSchema = z.object({
  invitation_id: z.number(),
  email: z.string().optional(),
  raw: z.unknown(),
});

const CancelPendingInvitationsOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      account_id: z.number(),
      user_id: z.number(),
      pending_count: z.number(),
      skipped_count: z.number(),
    }),
    current_invitations: z.array(z.unknown()),
    pending_invitations: z.array(PendingInvitationSchema),
    skipped: z.array(
      z.object({
        invitation_id: z.number(),
        reason: z.string(),
      }),
    ),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    account_id: z.number(),
    user_id: z.number(),
    canceled: z.array(
      z.object({
        invitation_id: z.number(),
        status: z.literal("canceled"),
      }),
    ),
    skipped: z.array(
      z.object({
        invitation_id: z.number(),
        reason: z.string(),
      }),
    ),
    message: z.string(),
  }),
]);

export const listAccountUsersTool = defineTool({
  name: "infomaniak_list_account_users",
  description:
    "List users attached to an Infomaniak account. Read-only admin inventory for access review and offboarding.",
  inputSchema: AccountUserInput,
  outputSchema: ListAccountUsersOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();
    const users = await client.request<unknown[]>(
      "GET",
      `/2/accounts/${input.account_id}/users`,
    );
    return {
      account_id: input.account_id,
      count: users.length,
      users,
    };
  },
});

export const getUserAppAccessesTool = defineTool({
  name: "infomaniak_get_user_app_accesses",
  description:
    "List app accesses for one account user. Read-only admin inventory for access audit and offboarding planning.",
  inputSchema: AccountUserAccessInput,
  outputSchema: UserAppAccessesOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();
    const appAccesses = await client.request<unknown[]>(
      "GET",
      `/2/accounts/${input.account_id}/users/${input.user_id}/app_accesses`,
    );
    return {
      account_id: input.account_id,
      user_id: input.user_id,
      count: appAccesses.length,
      app_accesses: appAccesses,
    };
  },
});

export const planUserOffboardingTool = defineTool({
  name: "infomaniak_plan_user_offboarding",
  description:
    "Build a read-only initial offboarding plan for one account user from app accesses and invitations. This does not revoke anything.",
  inputSchema: AccountUserAccessInput,
  outputSchema: UserOffboardingPlanOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();
    const [appAccesses, invitations] = await Promise.all([
      client.request<unknown[]>(
        "GET",
        `/2/accounts/${input.account_id}/users/${input.user_id}/app_accesses`,
      ),
      client.request<unknown[]>(
        "GET",
        `/1/accounts/${input.account_id}/invitations/users/${input.user_id}`,
      ),
    ]);

    return {
      status: "plan" as const,
      account_id: input.account_id,
      user_id: input.user_id,
      app_accesses: appAccesses,
      invitations,
      actions: buildOffboardingActions(appAccesses, invitations),
    };
  },
});

export const auditAccountAccessTool = defineTool({
  name: "infomaniak_audit_account_access",
  description:
    "Read-only admin audit of account users and their app accesses. Highlights privileged access, broad access, and per-user fetch errors.",
  inputSchema: AuditAccountAccessInput,
  outputSchema: AccountAccessAuditOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const users = await client.request<unknown[]>(
      "GET",
      `/2/accounts/${input.account_id}/users`,
    );
    const selectedUsers = users.slice(0, input.max_users);
    const summaries: Array<
      z.infer<typeof AccountAccessAuditOutput>["users"][number]
    > = [];
    const findings: Array<z.infer<typeof AccountAccessFindingSchema>> = [];
    let appAccessCount = 0;
    let privilegedUsers = 0;
    let errors = 0;

    for (const user of selectedUsers) {
      const userId = readNumericField(user, ["id", "user_id"]);
      const userEmail = readStringField(user, ["email", "mail", "username"]);
      if (userId === null) {
        findings.push({
          severity: "info",
          category: "uninspectable_user",
          message:
            "Could not determine a numeric user id for this account user.",
          ...(userEmail ? { user_email: userEmail } : {}),
        });
        continue;
      }

      try {
        const appAccesses = await client.request<unknown[]>(
          "GET",
          `/2/accounts/${input.account_id}/users/${userId}/app_accesses`,
        );
        const privilegedAccesses = appAccesses.filter(isPrivilegedAccess);
        appAccessCount += appAccesses.length;
        if (privilegedAccesses.length > 0) {
          privilegedUsers += 1;
          findings.push({
            severity: "warning",
            category: "privileged_access",
            message: `${privilegedAccesses.length} privileged app access record(s) found.`,
            user_id: userId,
            ...(userEmail ? { user_email: userEmail } : {}),
            app: privilegedAccesses.map(accessLabel).join(", "),
          });
        }
        if (appAccesses.length >= 10) {
          findings.push({
            severity: "info",
            category: "broad_access",
            message: `${appAccesses.length} app access record(s) attached to this user.`,
            user_id: userId,
            ...(userEmail ? { user_email: userEmail } : {}),
          });
        }
        summaries.push({
          user_id: userId,
          ...(userEmail ? { email: userEmail } : {}),
          app_access_count: appAccesses.length,
          privileged_access_count: privilegedAccesses.length,
        });
      } catch (err) {
        errors += 1;
        const message = err instanceof Error ? err.message : String(err);
        summaries.push({
          user_id: userId,
          ...(userEmail ? { email: userEmail } : {}),
          app_access_count: 0,
          privileged_access_count: 0,
          fetch_error: message,
        });
        findings.push({
          severity: "info",
          category: "access_fetch_error",
          message,
          user_id: userId,
          ...(userEmail ? { user_email: userEmail } : {}),
        });
      }
    }

    return {
      account_id: input.account_id,
      scanned_users: selectedUsers.length,
      summary: {
        users: selectedUsers.length,
        app_accesses: appAccessCount,
        privileged_users: privilegedUsers,
        errors,
      },
      users: summaries,
      findings,
      summary_markdown: renderAccountAccessAuditMarkdown(
        input.account_id,
        selectedUsers.length,
        appAccessCount,
        findings,
      ),
    };
  },
});

export const cancelPendingInvitationsTool = defineTool({
  name: "infomaniak_cancel_user_pending_invitations",
  description:
    "Cancel pending account invitations for a user. Two-phase commit: first call returns the pending invitation list and confirmation token; second call deletes only invitations still pending in the fresh apply prefetch.",
  inputSchema: CancelPendingInvitationsInput,
  outputSchema: CancelPendingInvitationsOutput,
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
    z.infer<typeof CancelPendingInvitationsInput>,
    unknown[],
    {
      plan: {
        account_id: number;
        user_id: number;
        pending_count: number;
        skipped_count: number;
      };
      current_invitations: unknown[];
      pending_invitations: Array<z.infer<typeof PendingInvitationSchema>>;
      skipped: Array<{ invitation_id: number; reason: string }>;
    },
    {
      account_id: number;
      user_id: number;
      canceled: Array<{ invitation_id: number; status: "canceled" }>;
      skipped: Array<{ invitation_id: number; reason: string }>;
      message: string;
    }
  >({
    toolName: "infomaniak_cancel_user_pending_invitations",
    loadCurrent: async (input) => {
      const client = new PublicApiClient();
      return await client.request<unknown[]>(
        "GET",
        `/1/accounts/${input.account_id}/invitations/users/${input.user_id}`,
      );
    },
    buildPlan: (input, invitations) => {
      const { pending, skipped } = partitionInvitations(invitations);
      return {
        plan: {
          account_id: input.account_id,
          user_id: input.user_id,
          pending_count: pending.length,
          skipped_count: skipped.length,
        },
        current_invitations: invitations,
        pending_invitations: pending,
        skipped,
      };
    },
    fingerprintPayload: (input, invitations, plan) => ({
      tool: "infomaniak_cancel_user_pending_invitations",
      account_id: input.account_id,
      user_id: input.user_id,
      invitations,
      pending_invitations: plan.pending_invitations,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      const canceled: Array<{ invitation_id: number; status: "canceled" }> = [];
      for (const invitation of plan.pending_invitations) {
        await client.request<unknown>(
          "DELETE",
          `/1/accounts/${input.account_id}/invitations/${invitation.invitation_id}`,
        );
        canceled.push({
          invitation_id: invitation.invitation_id,
          status: "canceled",
        });
      }
      if (canceled.length > 0) {
        recordHistory({
          tool: "infomaniak_cancel_user_pending_invitations",
          kind: "cancel_invitation",
          summary: `Canceled ${canceled.length} pending invitation(s) for user ${input.user_id} on account ${input.account_id}`,
          payload: {
            account_id: input.account_id,
            user_id: input.user_id,
            invitation_ids: canceled.map(
              (invitation) => invitation.invitation_id,
            ),
          },
        });
      }
      return {
        account_id: input.account_id,
        user_id: input.user_id,
        canceled,
        skipped: plan.skipped,
        message: `Canceled ${canceled.length} pending invitation(s).`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderCancelInvitationsPlanMarkdown(
        input,
        plan.pending_invitations,
        plan.skipped,
        token,
      ),
  }),
});

function buildOffboardingActions(
  appAccesses: ReadonlyArray<unknown>,
  invitations: ReadonlyArray<unknown>,
): Array<{ action: string; reason: string }> {
  const actions = [
    {
      action: "review_app_accesses",
      reason: `${appAccesses.length} app access record(s) should be reviewed before revocation.`,
    },
    {
      action: "inspect_mailbox_access",
      reason:
        "Mailbox access revocation uses mailbox invitation/access endpoints and should be planned explicitly.",
    },
    {
      action: "inspect_drive_access",
      reason:
        "kDrive access may include direct drive user rights, file access, and share links.",
    },
  ];

  if (invitations.length > 0) {
    actions.push({
      action: "cancel_pending_invitations",
      reason: `${invitations.length} invitation record(s) may need cancellation or patching.`,
    });
  }

  return actions;
}

function partitionInvitations(invitations: ReadonlyArray<unknown>): {
  pending: Array<z.infer<typeof PendingInvitationSchema>>;
  skipped: Array<{ invitation_id: number; reason: string }>;
} {
  const pending: Array<z.infer<typeof PendingInvitationSchema>> = [];
  const skipped: Array<{ invitation_id: number; reason: string }> = [];
  for (const invitation of invitations) {
    const invitationId = readNumericField(invitation, [
      "id",
      "invitation",
      "invitation_id",
    ]);
    if (invitationId === null) {
      continue;
    }
    if (isPendingInvitation(invitation)) {
      const email = readStringField(invitation, [
        "email",
        "recipient",
        "user_email",
      ]);
      pending.push({
        invitation_id: invitationId,
        ...(email ? { email } : {}),
        raw: invitation,
      });
    } else {
      skipped.push({ invitation_id: invitationId, reason: "not_pending" });
    }
  }
  return { pending, skipped };
}

function isPendingInvitation(invitation: unknown): boolean {
  const status = readStringField(invitation, ["status", "state"]);
  return typeof status === "string" && status.toLowerCase() === "pending";
}

function isPrivilegedAccess(access: unknown): boolean {
  if (!isRecord(access)) {
    return false;
  }
  const text = JSON.stringify(access).toLowerCase();
  return /\b(admin|administrator|owner|manager|write|full_access|super)\b/u.test(
    text,
  );
}

function accessLabel(access: unknown): string {
  return (
    readStringField(access, ["app", "application", "service", "product"]) ??
    readStringField(access, ["role", "right", "permission"]) ??
    "unknown"
  );
}

function readNumericField(
  value: unknown,
  keys: ReadonlyArray<string>,
): number | null {
  if (!isRecord(value)) {
    return null;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isInteger(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && /^\d+$/u.test(candidate)) {
      return Number(candidate);
    }
  }
  return null;
}

function readStringField(
  value: unknown,
  keys: ReadonlyArray<string>,
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function renderAccountAccessAuditMarkdown(
  accountId: number,
  scannedUsers: number,
  appAccessCount: number,
  findings: ReadonlyArray<z.infer<typeof AccountAccessFindingSchema>>,
): string {
  const warnings = findings.filter(
    (finding) => finding.severity === "warning",
  ).length;
  const critical = findings.filter(
    (finding) => finding.severity === "critical",
  ).length;
  const info = findings.filter((finding) => finding.severity === "info").length;
  return [
    `# Account access audit — account ${accountId}`,
    ``,
    `Scanned ${scannedUsers} user(s) and ${appAccessCount} app access record(s).`,
    ``,
    `- Critical: ${critical}`,
    `- Warning: ${warnings}`,
    `- Info: ${info}`,
    ``,
    ...findings.map(
      (finding) =>
        `- ${finding.severity.toUpperCase()} ${finding.category}: ${finding.message}${
          finding.user_id ? ` (user ${finding.user_id})` : ""
        }`,
    ),
  ].join("\n");
}

function renderCancelInvitationsPlanMarkdown(
  input: z.infer<typeof CancelPendingInvitationsInput>,
  pending: ReadonlyArray<z.infer<typeof PendingInvitationSchema>>,
  skipped: ReadonlyArray<{ invitation_id: number; reason: string }>,
  token: string,
): string {
  return [
    `# Plan — cancel pending invitations`,
    ``,
    `- Account: ${input.account_id}`,
    `- User: ${input.user_id}`,
    `- Pending invitations to cancel: ${pending.length}`,
    `- Skipped invitations: ${skipped.length}`,
    ``,
    ...pending.map(
      (invitation) =>
        `- DELETE invitation ${invitation.invitation_id}${
          invitation.email ? ` (${invitation.email})` : ""
        }`,
    ),
    ``,
    `Re-call \`infomaniak_cancel_user_pending_invitations\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}
