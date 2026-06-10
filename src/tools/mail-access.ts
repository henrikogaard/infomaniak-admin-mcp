import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const MailAccessScopeInput = z.object({
  mail_hosting_id: z.number().int().positive(),
  mailbox_name: z.string().min(1).optional(),
});

const MailAccessReadInput = MailAccessScopeInput.extend({
  action: z.enum([
    "inventory",
    "users",
    "user_team_accesses",
    "team_individual_users",
    "account_user",
    "account_team",
  ]),
  user_id: z.number().int().positive().optional(),
  team_id: z.number().int().positive().optional(),
  account_id: z.number().int().positive().optional(),
});

const MailAccessWriteInput = MailAccessScopeInput.extend({
  action: z.enum([
    "create_user",
    "update_user",
    "delete_user",
    "bulk_create_teams",
    "create_invitation",
    "send_invitation",
  ]),
  user_id: z.number().int().positive().optional(),
  team_id: z.number().int().positive().optional(),
  invitation_webmail: z
    .union([z.string().min(1), z.number().int().positive()])
    .optional(),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body to send to Infomaniak for this operation."),
  confirmation_token: z.string().uuid().optional(),
});

const ReadOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string().optional(),
  action: z.enum([
    "inventory",
    "users",
    "user_team_accesses",
    "team_individual_users",
    "account_user",
    "account_team",
  ]),
  result: z.unknown(),
});

const ConfirmedOutput = z.union([
  z.object({
    status: z.literal("plan"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string().optional(),
    action: z.enum([
      "create_user",
      "update_user",
      "delete_user",
      "bulk_create_teams",
      "create_invitation",
      "send_invitation",
    ]),
    current: z.unknown(),
    mutation: z.object({
      method: z.enum(["POST", "PATCH", "DELETE"]),
      path: z.string(),
      body: z.record(z.unknown()).optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string().optional(),
    action: z.enum([
      "create_user",
      "update_user",
      "delete_user",
      "bulk_create_teams",
      "create_invitation",
      "send_invitation",
    ]),
    result: z.unknown().optional(),
    message: z.string(),
  }),
]);

export const getMailAccessTool = defineTool({
  name: "infomaniak_get_mail_webmail_access",
  description:
    "Inspect mailbox webmail access for users and teams, plus admin audit lookups for account-scoped access records. Read-only inventory for webmail governance.",
  inputSchema: MailAccessReadInput,
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
      resolveMailAccessReadPath(input),
    );
    recordHistory({
      tool: "infomaniak_get_mail_webmail_access",
      kind: "mail_admin",
      summary: `Read webmail access inventory for ${describeMailAccessTarget(input)}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        action: input.action,
        ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
        ...(input.team_id !== undefined ? { team_id: input.team_id } : {}),
        ...(input.account_id !== undefined
          ? { account_id: input.account_id }
          : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      action: input.action,
      result,
    };
  },
});

export const manageMailAccessTool = defineMailMutationTool({
  name: "infomaniak_manage_mail_webmail_access",
  description:
    "Create, update, delete, or invite webmail access for mailbox users and teams. Uses two-phase confirmation and refetches current access state before apply.",
  inputSchema: MailAccessWriteInput,
  loadCurrent: async (input) => readMailAccessCurrent(input),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
    action: input.action,
    current,
    mutation: buildMailAccessMutation(input),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const mutation = buildMailAccessMutation(input);
    const result = await client.request<unknown>(
      mutation.method,
      mutation.path,
      {
        body: mutation.body,
      },
    );
    recordHistory({
      tool: "infomaniak_manage_mail_webmail_access",
      kind: "mail_admin",
      summary: `${input.action} webmail access for ${describeMailAccessTarget(input)}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        action: input.action,
        ...(input.user_id !== undefined ? { user_id: input.user_id } : {}),
        ...(input.team_id !== undefined ? { team_id: input.team_id } : {}),
        ...(input.invitation_webmail !== undefined
          ? { invitation_webmail: input.invitation_webmail }
          : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      action: input.action,
      result,
      message: `✅ Mail webmail access ${input.action}.`,
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

async function readMailAccessCurrent(
  input: z.infer<typeof MailAccessWriteInput>,
): Promise<unknown> {
  const client = new PublicApiClient();
  if (input.action === "update_user" || input.action === "delete_user") {
    return await client.request<unknown>(
      "GET",
      `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(requireMailboxName(input))}/accesses/webmail/users`,
    );
  }
  return await client.request<unknown>(
    "GET",
    `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(requireMailboxName(input))}/accesses/webmail`,
  );
}

function buildMailAccessMutation(input: z.infer<typeof MailAccessWriteInput>): {
  method: "POST" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
} {
  const mailboxName = requireMailboxName(input);
  const base = `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(mailboxName)}/accesses/webmail`;
  switch (input.action) {
    case "create_user":
      return { method: "POST", path: base, body: input.payload ?? {} };
    case "update_user":
      return {
        method: "PATCH",
        path: `${base}/users/${encodeURIComponent(requireUserId(input))}`,
        body: input.payload ?? {},
      };
    case "delete_user":
      return {
        method: "DELETE",
        path: `${base}/users/${encodeURIComponent(requireUserId(input))}`,
      };
    case "bulk_create_teams":
      return {
        method: "POST",
        path: `${base}/teams/bulk`,
        body: input.payload ?? {},
      };
    case "create_invitation":
      return {
        method: "POST",
        path: `${base}/invitations`,
        body: input.payload ?? {},
      };
    case "send_invitation":
      return {
        method: "POST",
        path: `${base}/invitations/${encodeURIComponent(requireInvitationId(input))}/send`,
      };
  }
}

function resolveMailAccessReadPath(
  input: z.infer<typeof MailAccessReadInput>,
): string {
  switch (input.action) {
    case "inventory":
      return mailboxBase(input, "/accesses/webmail");
    case "users":
      return mailboxBase(input, "/accesses/webmail/users");
    case "user_team_accesses":
      return `${mailboxBase(input, "/accesses/webmail/users")}/${encodeURIComponent(requireUserId(input))}/team_accesses`;
    case "team_individual_users":
      return `${mailboxBase(input, "/accesses/webmail/teams")}/${encodeURIComponent(requireTeamId(input))}/individual_users`;
    case "account_user":
      return `/1/mail_hostings/accesses/webmail/accounts/${encodeURIComponent(requireAccountId(input))}/users/${encodeURIComponent(requireUserId(input))}`;
    case "account_team":
      return `/1/mail_hostings/accesses/webmail/accounts/${encodeURIComponent(requireAccountId(input))}/teams/${encodeURIComponent(requireTeamId(input))}`;
  }
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
      "mailbox_name is required for mailbox-scoped webmail access actions",
    );
  }
  return input.mailbox_name;
}

function requireUserId(input: { user_id?: number | undefined }): number {
  if (input.user_id === undefined) {
    throw new Error("user_id is required for this webmail access action");
  }
  return input.user_id;
}

function requireTeamId(input: { team_id?: number | undefined }): number {
  if (input.team_id === undefined) {
    throw new Error("team_id is required for this webmail access action");
  }
  return input.team_id;
}

function requireAccountId(input: { account_id?: number | undefined }): number {
  if (input.account_id === undefined) {
    throw new Error("account_id is required for this webmail access action");
  }
  return input.account_id;
}

function requireInvitationId(input: {
  invitation_webmail?: string | number | undefined;
}): string | number {
  if (
    input.invitation_webmail === undefined ||
    input.invitation_webmail === null ||
    input.invitation_webmail === ""
  ) {
    throw new Error(
      "invitation_webmail is required for this webmail access action",
    );
  }
  return input.invitation_webmail;
}

function describeMailAccessTarget(input: {
  mailbox_name?: string | undefined;
  action: string;
  user_id?: number | undefined;
  team_id?: number | undefined;
  account_id?: number | undefined;
}): string {
  if (input.mailbox_name) {
    return `${input.mailbox_name} mailbox`;
  }
  if (input.account_id !== undefined) {
    return `account ${input.account_id}`;
  }
  if (input.team_id !== undefined) {
    return `team ${input.team_id}`;
  }
  if (input.user_id !== undefined) {
    return `user ${input.user_id}`;
  }
  return input.action;
}

function renderPlanMarkdown(
  input: z.infer<typeof MailAccessWriteInput>,
  plan: Record<string, unknown>,
  token: string,
): string {
  const mutation = plan["mutation"] as Record<string, unknown> | undefined;
  return [
    `## Plan - manage mail webmail access`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: ${input.mailbox_name ?? "n/a"}`,
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
