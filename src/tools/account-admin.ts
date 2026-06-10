import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const AccountScopeInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .describe("Infomaniak account/organization ID."),
});

const InvitationIdInput = AccountScopeInput.extend({
  invitation_id: z.number().int().positive().describe("Invitation identifier."),
});

const TeamIdInput = AccountScopeInput.extend({
  team_id: z.number().int().positive().describe("Team identifier."),
});

const TagIdInput = AccountScopeInput.extend({
  tag_id: z.number().int().positive().describe("Tag identifier."),
});

const GenericPayloadInput = z
  .record(z.unknown())
  .describe("Request body accepted by the corresponding Infomaniak endpoint.");

const CreateInvitationInput = AccountScopeInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const UpdateInvitationInput = InvitationIdInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const DeleteInvitationInput = InvitationIdInput.extend({
  confirmation_token: z.string().uuid().optional(),
});

const CreateTeamInput = AccountScopeInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const UpdateTeamInput = TeamIdInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const DeleteTeamInput = TeamIdInput.extend({
  confirmation_token: z.string().uuid().optional(),
});

const TeamUsersMutationInput = TeamIdInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const CreateTagInput = AccountScopeInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const UpdateTagInput = TagIdInput.extend({
  payload: GenericPayloadInput,
  confirmation_token: z.string().uuid().optional(),
});

const DeleteTagInput = TagIdInput.extend({
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
      .object({
        status: z.literal("applied"),
        result: z.unknown().optional(),
        message: z.string(),
      })
      .passthrough(),
  ])
  .describe("Two-phase confirmation result.");

export const createAccountInvitationTool = defineAccountMutationTool({
  name: "infomaniak_create_account_invitation",
  description:
    "Create an account invitation. Two-phase commit with a fresh account snapshot guard. The payload is passed through to Infomaniak as-is.",
  inputSchema: CreateInvitationInput,
  kind: "account_admin",
  loadCurrent: async (input) => readAccountSnapshot(input.account_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    action: "create_invitation",
    current_snapshot: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "POST",
      `/1/accounts/${input.account_id}/invitations`,
      {
        body: input.payload,
      },
    );
    recordHistory({
      tool: "infomaniak_create_account_invitation",
      kind: "account_admin",
      summary: `Created account invitation on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      result,
      message: "✅ Account invitation created.",
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "create account invitation",
      input.account_id,
      plan,
      token,
    ),
});

export const updateAccountInvitationTool = defineAccountMutationTool({
  name: "infomaniak_update_account_invitation",
  description:
    "Patch an account invitation. Two-phase commit with a fresh invitation snapshot guard.",
  inputSchema: UpdateInvitationInput,
  kind: "account_admin",
  loadCurrent: async (input) =>
    readAccountInvitation(input.account_id, input.invitation_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    invitation_id: input.invitation_id,
    action: "update_invitation",
    current_invitation: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "PATCH",
      `/1/accounts/${input.account_id}/invitations/${input.invitation_id}`,
      { body: input.payload },
    );
    recordHistory({
      tool: "infomaniak_update_account_invitation",
      kind: "account_admin",
      summary: `Updated account invitation ${input.invitation_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        invitation_id: input.invitation_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      invitation_id: input.invitation_id,
      result,
      message: `✅ Account invitation ${input.invitation_id} updated.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "update account invitation",
      input.account_id,
      plan,
      token,
    ),
});

export const deleteAccountInvitationTool = defineAccountMutationTool({
  name: "infomaniak_delete_account_invitation",
  description:
    "Delete an account invitation. Two-phase commit with a fresh invitation snapshot guard.",
  inputSchema: DeleteInvitationInput,
  kind: "account_admin",
  loadCurrent: async (input) =>
    readAccountInvitation(input.account_id, input.invitation_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    invitation_id: input.invitation_id,
    action: "delete_invitation",
    current_invitation: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "DELETE",
      `/1/accounts/${input.account_id}/invitations/${input.invitation_id}`,
    );
    recordHistory({
      tool: "infomaniak_delete_account_invitation",
      kind: "account_admin",
      summary: `Deleted account invitation ${input.invitation_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        invitation_id: input.invitation_id,
      },
    });
    return {
      account_id: input.account_id,
      invitation_id: input.invitation_id,
      result,
      message: `✅ Account invitation ${input.invitation_id} deleted.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "delete account invitation",
      input.account_id,
      plan,
      token,
    ),
});

export const createAccountTeamTool = defineAccountMutationTool({
  name: "infomaniak_create_account_team",
  description:
    "Create an account team. Two-phase commit with a fresh team list snapshot guard. The payload is passed through to Infomaniak as-is.",
  inputSchema: CreateTeamInput,
  kind: "account_admin",
  loadCurrent: async (input) => readAccountTeams(input.account_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    action: "create_team",
    current_teams: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "POST",
      `/1/accounts/${input.account_id}/teams`,
      {
        body: input.payload,
      },
    );
    recordHistory({
      tool: "infomaniak_create_account_team",
      kind: "account_admin",
      summary: `Created account team on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      result,
      message: "✅ Account team created.",
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "create account team",
      input.account_id,
      plan,
      token,
    ),
});

export const updateAccountTeamTool = defineAccountMutationTool({
  name: "infomaniak_update_account_team",
  description:
    "Update an account team. Two-phase commit with a fresh team snapshot guard.",
  inputSchema: UpdateTeamInput,
  kind: "account_admin",
  loadCurrent: async (input) =>
    readAccountTeam(input.account_id, input.team_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    team_id: input.team_id,
    action: "update_team",
    current_team: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "PATCH",
      `/1/accounts/${input.account_id}/teams/${input.team_id}`,
      { body: input.payload },
    );
    recordHistory({
      tool: "infomaniak_update_account_team",
      kind: "account_admin",
      summary: `Updated account team ${input.team_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        team_id: input.team_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      team_id: input.team_id,
      result,
      message: `✅ Account team ${input.team_id} updated.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "update account team",
      input.account_id,
      plan,
      token,
    ),
});

export const deleteAccountTeamTool = defineAccountMutationTool({
  name: "infomaniak_delete_account_team",
  description:
    "Delete an account team. Two-phase commit with a fresh team snapshot guard.",
  inputSchema: DeleteTeamInput,
  kind: "account_admin",
  loadCurrent: async (input) =>
    readAccountTeam(input.account_id, input.team_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    team_id: input.team_id,
    action: "delete_team",
    current_team: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "DELETE",
      `/1/accounts/${input.account_id}/teams/${input.team_id}`,
    );
    recordHistory({
      tool: "infomaniak_delete_account_team",
      kind: "account_admin",
      summary: `Deleted account team ${input.team_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        team_id: input.team_id,
      },
    });
    return {
      account_id: input.account_id,
      team_id: input.team_id,
      result,
      message: `✅ Account team ${input.team_id} deleted.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "delete account team",
      input.account_id,
      plan,
      token,
    ),
});

export const addAccountTeamUsersTool = defineAccountMutationTool({
  name: "infomaniak_add_account_team_users",
  description:
    "Add one or more users to an account team. Two-phase commit with a fresh team-members snapshot guard.",
  inputSchema: TeamUsersMutationInput,
  kind: "account_admin",
  loadCurrent: async (input) =>
    readAccountTeamUsers(input.account_id, input.team_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    team_id: input.team_id,
    action: "add_team_users",
    current_users: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "POST",
      `/1/accounts/${input.account_id}/teams/${input.team_id}/users`,
      { body: input.payload },
    );
    recordHistory({
      tool: "infomaniak_add_account_team_users",
      kind: "account_admin",
      summary: `Added users to account team ${input.team_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        team_id: input.team_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      team_id: input.team_id,
      result,
      message: `✅ Users added to account team ${input.team_id}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "add users to account team",
      input.account_id,
      plan,
      token,
    ),
});

export const removeAccountTeamUsersTool = defineAccountMutationTool({
  name: "infomaniak_remove_account_team_users",
  description:
    "Remove one or more users from an account team. Two-phase commit with a fresh team-members snapshot guard.",
  inputSchema: TeamUsersMutationInput,
  kind: "account_admin",
  loadCurrent: async (input) =>
    readAccountTeamUsers(input.account_id, input.team_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    team_id: input.team_id,
    action: "remove_team_users",
    current_users: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "DELETE",
      `/1/accounts/${input.account_id}/teams/${input.team_id}/users`,
      { body: input.payload },
    );
    recordHistory({
      tool: "infomaniak_remove_account_team_users",
      kind: "account_admin",
      summary: `Removed users from account team ${input.team_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        team_id: input.team_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      team_id: input.team_id,
      result,
      message: `✅ Users removed from account team ${input.team_id}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "remove users from account team",
      input.account_id,
      plan,
      token,
    ),
});

export const createAccountTagTool = defineAccountMutationTool({
  name: "infomaniak_create_account_tag",
  description:
    "Create an account tag. Two-phase commit with a fresh tag-list snapshot guard. The payload is passed through to Infomaniak as-is.",
  inputSchema: CreateTagInput,
  kind: "account_admin",
  loadCurrent: async (input) => readAccountTags(input.account_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    action: "create_tag",
    current_tags: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "POST",
      `/1/accounts/${input.account_id}/tags`,
      {
        body: input.payload,
      },
    );
    recordHistory({
      tool: "infomaniak_create_account_tag",
      kind: "account_admin",
      summary: `Created account tag on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      result,
      message: "✅ Account tag created.",
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "create account tag",
      input.account_id,
      plan,
      token,
    ),
});

export const updateAccountTagTool = defineAccountMutationTool({
  name: "infomaniak_update_account_tag",
  description:
    "Update an account tag. Two-phase commit with a fresh tag snapshot guard.",
  inputSchema: UpdateTagInput,
  kind: "account_admin",
  loadCurrent: async (input) => readAccountTag(input.account_id, input.tag_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    tag_id: input.tag_id,
    action: "update_tag",
    current_tag: current,
    payload: input.payload,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "PUT",
      `/1/accounts/${input.account_id}/tags/${input.tag_id}`,
      { body: input.payload },
    );
    recordHistory({
      tool: "infomaniak_update_account_tag",
      kind: "account_admin",
      summary: `Updated account tag ${input.tag_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        tag_id: input.tag_id,
        payload: input.payload,
      },
    });
    return {
      account_id: input.account_id,
      tag_id: input.tag_id,
      result,
      message: `✅ Account tag ${input.tag_id} updated.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "update account tag",
      input.account_id,
      plan,
      token,
    ),
});

export const deleteAccountTagTool = defineAccountMutationTool({
  name: "infomaniak_delete_account_tag",
  description:
    "Delete an account tag. Two-phase commit with a fresh tag snapshot guard.",
  inputSchema: DeleteTagInput,
  kind: "account_admin",
  loadCurrent: async (input) => readAccountTag(input.account_id, input.tag_id),
  buildPlan: (input, current) => ({
    account_id: input.account_id,
    tag_id: input.tag_id,
    action: "delete_tag",
    current_tag: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const result = await client.request<unknown>(
      "DELETE",
      `/1/accounts/${input.account_id}/tags/${input.tag_id}`,
    );
    recordHistory({
      tool: "infomaniak_delete_account_tag",
      kind: "account_admin",
      summary: `Deleted account tag ${input.tag_id} on account ${input.account_id}`,
      payload: {
        account_id: input.account_id,
        tag_id: input.tag_id,
      },
    });
    return {
      account_id: input.account_id,
      tag_id: input.tag_id,
      result,
      message: `✅ Account tag ${input.tag_id} deleted.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "delete account tag",
      input.account_id,
      plan,
      token,
    ),
});

function defineAccountMutationTool<
  TInput extends z.ZodTypeAny,
  TCurrent,
  TPlan extends Record<string, unknown>,
  TApplied extends Record<string, unknown>,
>(config: {
  name: string;
  description: string;
  inputSchema: TInput;
  kind: "account_admin";
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
    outputSchema: GenericMutationOutput,
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

async function readAccountSnapshot(accountId: number): Promise<unknown> {
  const client = new PublicApiClient();
  const [users, teams, tags] = await Promise.all([
    client.request<unknown[]>("GET", `/2/accounts/${accountId}/users`),
    client.request<unknown[]>("GET", `/1/accounts/${accountId}/teams`),
    client.request<unknown[]>("GET", `/1/accounts/${accountId}/tags`),
  ]);
  return { users, teams, tags };
}

async function readAccountTeams(accountId: number): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown[]>(
    "GET",
    `/1/accounts/${accountId}/teams`,
  );
}

async function readAccountTeam(
  accountId: number,
  teamId: number,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/accounts/${accountId}/teams/${teamId}`,
  );
}

async function readAccountTeamUsers(
  accountId: number,
  teamId: number,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown[]>(
    "GET",
    `/1/accounts/${accountId}/teams/${teamId}/users`,
  );
}

async function readAccountTags(accountId: number): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown[]>(
    "GET",
    `/1/accounts/${accountId}/tags`,
  );
}

async function readAccountTag(
  accountId: number,
  tagId: number,
): Promise<unknown> {
  const tags = (await readAccountTags(accountId)) as unknown[];
  return findByNumericId(tags, tagId, ["id", "tag", "tag_id"]);
}

async function readAccountInvitation(
  accountId: number,
  invitationId: number,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/accounts/${accountId}/invitations/${invitationId}`,
  );
}

function findByNumericId(
  items: ReadonlyArray<unknown>,
  targetId: number,
  keys: ReadonlyArray<string>,
): unknown {
  return (
    items.find((item) => {
      if (!isRecord(item)) {
        return false;
      }
      for (const key of keys) {
        const value = item[key];
        if (typeof value === "number" && value === targetId) {
          return true;
        }
        if (
          typeof value === "string" &&
          /^\d+$/u.test(value) &&
          Number(value) === targetId
        ) {
          return true;
        }
      }
      return false;
    }) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function renderGenericPlanMarkdown(
  title: string,
  accountId: number,
  plan: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — ${title}`,
    ``,
    `- **Account**: ${accountId}`,
    `- **Action**: ${String(plan["action"] ?? "update")}`,
    ``,
    `### Target snapshot`,
    `\`\`\`json`,
    `${JSON.stringify(plan, null, 2)}`,
    `\`\`\``,
    ``,
    `### Next step`,
    `Re-call with \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}
