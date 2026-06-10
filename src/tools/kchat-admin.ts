import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const KchatListOutput = z.object({
  items: z.array(z.unknown()),
  summary_markdown: z.string(),
});

const KchatItemOutput = z.object({
  item: z.unknown(),
  summary_markdown: z.string(),
});

const KchatMutationOutput = z.union([
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
]);

const KchatChannelsInput = z.object({
  team_id: z.string().min(1).optional().describe("Optional kChat team id."),
});

const KchatTeamChannelsInput = z.object({
  team_id: z.string().min(1).describe("kChat team id."),
  visibility: z.enum(["public", "private", "deleted"]).default("public"),
});

const KchatChannelInput = z.object({
  channel_id: z.string().min(1).describe("kChat channel id."),
});

const KchatMemberListInput = KchatChannelInput.extend({
  user_id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional user id to fetch a specific member."),
});

const KchatGroupsInput = z.object({
  scope: z
    .enum(["all", "team", "team_by_channels", "channel", "user"])
    .default("all"),
  team_id: z.string().min(1).optional(),
  channel_id: z.string().min(1).optional(),
  user_id: z.string().min(1).optional(),
});

const KchatCommandListInput = z.object({
  team_id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional team id to filter commands."),
});

const KchatCommandInput = z.object({
  command_id: z.string().min(1).describe("kChat command id."),
});

const KchatBotInput = z.object({
  bot_user_id: z.string().min(1).describe("kChat bot user id."),
});

const KchatChannelMutationInput = z.object({
  action: z.enum([
    "create",
    "update",
    "patch",
    "delete",
    "restore",
    "move",
    "privacy",
    "scheme",
    "moderations",
  ]),
  team_id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional team id used for create snapshots."),
  channel_id: z
    .string()
    .min(1)
    .optional()
    .describe("Channel id for non-create actions."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body accepted by the target channel endpoint."),
  confirmation_token: z.string().uuid().optional(),
});

const KchatChannelMemberMutationInput = z.object({
  action: z.enum([
    "add",
    "remove",
    "update_roles",
    "update_scheme_roles",
    "update_notify_props",
  ]),
  channel_id: z.string().min(1).describe("kChat channel id."),
  user_id: z
    .string()
    .min(1)
    .optional()
    .describe("User id for single-user member mutations."),
  user_ids: z
    .array(z.string().min(1))
    .nonempty()
    .optional()
    .describe("One or more user ids to add."),
  roles: z.string().optional().describe("Role string for update_roles."),
  scheme_roles: z
    .string()
    .optional()
    .describe("Scheme-derived roles for update_scheme_roles."),
  notify_props: z
    .record(z.unknown())
    .optional()
    .describe("Notification properties for update_notify_props."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body for the member endpoint."),
  confirmation_token: z.string().uuid().optional(),
});

const KchatCommandMutationInput = z.object({
  action: z.enum(["create", "update", "delete", "regen_token"]),
  team_id: z
    .string()
    .min(1)
    .optional()
    .describe("Optional team id used when listing commands for create."),
  command_id: z
    .string()
    .min(1)
    .optional()
    .describe("Command id for update/delete/regen_token."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body accepted by the command endpoint."),
  confirmation_token: z.string().uuid().optional(),
});

const KchatBotMutationInput = z.object({
  action: z.enum(["create", "update", "enable", "disable", "delete"]),
  bot_user_id: z
    .string()
    .min(1)
    .optional()
    .describe("Bot user id for update/enable/disable/delete."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body accepted by the bot endpoint."),
  confirmation_token: z.string().uuid().optional(),
});

export const listKchatChannelsTool = defineTool({
  name: "infomaniak_list_kchat_channels",
  description:
    "List kChat channels in the account. This stays on the admin/governance side of the Mattermost-compatible API surface.",
  inputSchema: KchatChannelsInput,
  outputSchema: KchatListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const items = await readKchatChannels(input.team_id);
    return {
      items,
      summary_markdown: renderCollectionSummary(
        "kChat channels",
        items.length,
        input.team_id ? `Team filter: ${input.team_id}` : undefined,
      ),
    };
  },
});

export const listKchatTeamChannelsTool = defineTool({
  name: "infomaniak_list_kchat_team_channels",
  description:
    "List the public, private, or deleted channels for one kChat team. Useful for admin inventory and channel governance.",
  inputSchema: KchatTeamChannelsInput,
  outputSchema: KchatListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const path =
      input.visibility === "public"
        ? `/api/v4/teams/${encodeURIComponent(input.team_id)}/channels`
        : input.visibility === "private"
          ? `/api/v4/teams/${encodeURIComponent(input.team_id)}/channels/private`
          : `/api/v4/teams/${encodeURIComponent(input.team_id)}/channels/deleted`;
    const items = await client.request<unknown[]>("GET", path);
    return {
      items,
      summary_markdown: renderCollectionSummary(
        `kChat ${input.visibility} channels`,
        items.length,
        `team ${input.team_id}`,
      ),
    };
  },
});

export const getKchatChannelTool = defineTool({
  name: "infomaniak_get_kchat_channel",
  description: "Get one kChat channel for admin inspection.",
  inputSchema: KchatChannelInput,
  outputSchema: KchatItemOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const item = await readKchatChannel(input.channel_id);
    return {
      item,
      summary_markdown: `# kChat channel\n\nChannel id: \`${input.channel_id}\``,
    };
  },
});

export const listKchatChannelMembersTool = defineTool({
  name: "infomaniak_list_kchat_channel_members",
  description:
    "List the members of a kChat channel, optionally including one specific member snapshot.",
  inputSchema: KchatMemberListInput,
  outputSchema: z.object({
    members: z.array(z.unknown()),
    member: z.unknown().optional(),
    summary_markdown: z.string(),
  }),
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const members = await client.request<unknown[]>(
      "GET",
      `/api/v4/channels/${encodeURIComponent(input.channel_id)}/members`,
    );
    let member: unknown;
    if (input.user_id) {
      member = await client.request<unknown>(
        "GET",
        `/api/v4/channels/${encodeURIComponent(input.channel_id)}/members/${encodeURIComponent(input.user_id)}`,
      );
    }
    return {
      members,
      ...(member !== undefined ? { member } : {}),
      summary_markdown: renderCollectionSummary(
        "kChat channel members",
        members.length,
        input.user_id
          ? `channel ${input.channel_id}, member ${input.user_id}`
          : `channel ${input.channel_id}`,
      ),
    };
  },
});

export const getKchatChannelModerationTool = defineTool({
  name: "infomaniak_get_kchat_channel_moderation",
  description: "Inspect the moderation settings for a kChat channel.",
  inputSchema: KchatChannelInput,
  outputSchema: KchatItemOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const item = await readKchatChannelModeration(input.channel_id);
    return {
      item,
      summary_markdown: `# kChat channel moderation\n\nChannel id: \`${input.channel_id}\``,
    };
  },
});

export const listKchatGroupsTool = defineTool({
  name: "infomaniak_list_kchat_groups",
  description:
    "List kChat groups for a team, channel, or user. This is useful for auditing permission-linked group sync.",
  inputSchema: KchatGroupsInput,
  outputSchema: KchatListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const items = await readKchatGroups(input);
    const { description } = buildGroupPath(input);
    return {
      items,
      summary_markdown: renderCollectionSummary(
        "kChat groups",
        items.length,
        description,
      ),
    };
  },
});

export const listKchatBotsTool = defineTool({
  name: "infomaniak_list_kchat_bots",
  description: "List kChat bots for admin review.",
  inputSchema: z.object({}),
  outputSchema: KchatListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async () => {
    const items = await readKchatBots();
    return {
      items,
      summary_markdown: renderCollectionSummary("kChat bots", items.length),
    };
  },
});

export const getKchatBotTool = defineTool({
  name: "infomaniak_get_kchat_bot",
  description: "Inspect one kChat bot.",
  inputSchema: KchatBotInput,
  outputSchema: KchatItemOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const item = await readKchatBot(input.bot_user_id);
    return {
      item,
      summary_markdown: `# kChat bot\n\nBot user id: \`${input.bot_user_id}\``,
    };
  },
});

export const listKchatCommandsTool = defineTool({
  name: "infomaniak_list_kchat_commands",
  description: "List kChat slash commands for a team or the account.",
  inputSchema: KchatCommandListInput,
  outputSchema: KchatListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const items = await client.request<unknown[]>("GET", "/api/v4/commands", {
      ...(input.team_id ? { query: { team_id: input.team_id } } : {}),
    });
    return {
      items,
      summary_markdown: renderCollectionSummary(
        "kChat commands",
        items.length,
        input.team_id ? `team ${input.team_id}` : undefined,
      ),
    };
  },
});

export const getKchatCommandTool = defineTool({
  name: "infomaniak_get_kchat_command",
  description: "Inspect one kChat slash command.",
  inputSchema: KchatCommandInput,
  outputSchema: KchatItemOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const item = await readKchatCommand(input.command_id);
    return {
      item,
      summary_markdown: `# kChat command\n\nCommand id: \`${input.command_id}\``,
    };
  },
});

export const listKchatRolesTool = defineTool({
  name: "infomaniak_list_kchat_roles",
  description: "List kChat roles for permission auditing.",
  inputSchema: z.object({}),
  outputSchema: KchatListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async () => {
    const items = await readKchatRoles();
    return {
      items,
      summary_markdown: renderCollectionSummary("kChat roles", items.length),
    };
  },
});

export const manageKchatChannelTool = defineKchatMutationTool({
  name: "infomaniak_manage_kchat_channel",
  description:
    "Create, update, patch, move, restore, delete, or change privacy/scheme/moderation for a kChat channel. Two-phase confirmation for all writes.",
  inputSchema: KchatChannelMutationInput,
  loadCurrent: async (input) => {
    if (input.action === "create") {
      return input.team_id
        ? await readKchatTeamChannels(input.team_id, "public")
        : await readKchatChannels();
    }
    return await readKchatChannel(requireValue(input.channel_id, "channel_id"));
  },
  buildPlan: (input, current) => ({
    action: input.action,
    ...(input.team_id ? { team_id: input.team_id } : {}),
    ...(input.channel_id ? { channel_id: input.channel_id } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    current_snapshot: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    let result: unknown;
    switch (input.action) {
      case "create":
        result = await client.request<unknown>("POST", "/api/v4/channels", {
          body: input.payload ?? {},
        });
        break;
      case "update":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}`,
          { body: input.payload ?? {} },
        );
        break;
      case "patch":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/patch`,
          { body: input.payload ?? {} },
        );
        break;
      case "delete":
        result = await client.request<unknown>(
          "DELETE",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}`,
        );
        break;
      case "restore":
        result = await client.request<unknown>(
          "POST",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/restore`,
        );
        break;
      case "move":
        result = await client.request<unknown>(
          "POST",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/move`,
          { body: input.payload ?? {} },
        );
        break;
      case "privacy":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/privacy`,
          { body: input.payload ?? {} },
        );
        break;
      case "scheme":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/scheme`,
          { body: input.payload ?? {} },
        );
        break;
      case "moderations":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/moderations/patch`,
          { body: input.payload ?? {} },
        );
        break;
    }
    recordHistory({
      tool: "infomaniak_manage_kchat_channel",
      kind: "kchat_admin",
      summary: `kChat channel ${input.action}${input.channel_id ? ` on ${input.channel_id}` : ""}`,
      payload: {
        action: input.action,
        ...(input.team_id ? { team_id: input.team_id } : {}),
        ...(input.channel_id ? { channel_id: input.channel_id } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      },
    });
    return {
      action: input.action,
      ...(input.team_id ? { team_id: input.team_id } : {}),
      ...(input.channel_id ? { channel_id: input.channel_id } : {}),
      result,
      message: `✅ kChat channel ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderMutationPlanMarkdown("kChat channel", input.action, plan, token),
});

export const manageKchatChannelMembersTool = defineKchatMutationTool({
  name: "infomaniak_manage_kchat_channel_members",
  description:
    "Add or remove channel members, or update a member's roles / scheme roles / notify props. Two-phase confirmation for every mutation.",
  inputSchema: KchatChannelMemberMutationInput,
  loadCurrent: async (input) =>
    readKchatChannelMemberState(input.channel_id, input.user_id),
  buildPlan: (input, current) => ({
    action: input.action,
    channel_id: input.channel_id,
    ...(input.user_id ? { user_id: input.user_id } : {}),
    ...(input.user_ids ? { user_ids: input.user_ids } : {}),
    ...(input.roles ? { roles: input.roles } : {}),
    ...(input.scheme_roles ? { scheme_roles: input.scheme_roles } : {}),
    ...(input.notify_props ? { notify_props: input.notify_props } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    current_snapshot: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const channelPath = `/api/v4/channels/${encodeURIComponent(input.channel_id)}/members`;
    let result: unknown;
    switch (input.action) {
      case "add": {
        const body =
          input.payload ??
          (input.user_ids
            ? { user_ids: input.user_ids }
            : input.user_id
              ? { user_ids: [input.user_id] }
              : undefined);
        if (body === undefined) {
          throw new Error(
            "user_ids, user_id, or payload is required when action=add",
          );
        }
        result = await client.request<unknown>("POST", channelPath, { body });
        break;
      }
      case "remove":
        result = await client.request<unknown>(
          "DELETE",
          `${channelPath}/${encodeURIComponent(requireValue(input.user_id, "user_id"))}`,
        );
        break;
      case "update_roles": {
        const body =
          input.payload ?? (input.roles ? { roles: input.roles } : undefined);
        if (body === undefined) {
          throw new Error(
            "roles or payload is required when action=update_roles",
          );
        }
        result = await client.request<unknown>(
          "PUT",
          `${channelPath}/${encodeURIComponent(requireValue(input.user_id, "user_id"))}/roles`,
          { body },
        );
        break;
      }
      case "update_scheme_roles": {
        const body =
          input.payload ??
          (input.scheme_roles
            ? { scheme_roles: input.scheme_roles }
            : undefined);
        if (body === undefined) {
          throw new Error(
            "scheme_roles or payload is required when action=update_scheme_roles",
          );
        }
        result = await client.request<unknown>(
          "PUT",
          `${channelPath}/${encodeURIComponent(requireValue(input.user_id, "user_id"))}/schemeRoles`,
          { body },
        );
        break;
      }
      case "update_notify_props": {
        const body =
          input.payload ??
          (input.notify_props
            ? { notify_props: input.notify_props }
            : undefined);
        if (body === undefined) {
          throw new Error(
            "notify_props or payload is required when action=update_notify_props",
          );
        }
        result = await client.request<unknown>(
          "PUT",
          `${channelPath}/${encodeURIComponent(requireValue(input.user_id, "user_id"))}/notify_props`,
          { body },
        );
        break;
      }
    }
    recordHistory({
      tool: "infomaniak_manage_kchat_channel_members",
      kind: "kchat_admin",
      summary: `kChat channel member ${input.action} on ${input.channel_id}`,
      payload: {
        action: input.action,
        channel_id: input.channel_id,
        ...(input.user_id ? { user_id: input.user_id } : {}),
        ...(input.user_ids ? { user_ids: input.user_ids } : {}),
        ...(input.roles ? { roles: input.roles } : {}),
        ...(input.scheme_roles ? { scheme_roles: input.scheme_roles } : {}),
        ...(input.notify_props ? { notify_props: input.notify_props } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      },
    });
    return {
      action: input.action,
      channel_id: input.channel_id,
      ...(input.user_id ? { user_id: input.user_id } : {}),
      result,
      message: `✅ kChat channel member ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderMutationPlanMarkdown(
      "kChat channel member",
      input.action,
      plan,
      token,
    ),
});

export const manageKchatCommandTool = defineKchatMutationTool({
  name: "infomaniak_manage_kchat_command",
  description:
    "Create, update, delete, or regenerate a kChat slash command token. Two-phase confirmation for writes.",
  inputSchema: KchatCommandMutationInput,
  loadCurrent: async (input) => {
    if (input.action === "create") {
      return await readKchatCommands(input.team_id);
    }
    return await readKchatCommand(requireValue(input.command_id, "command_id"));
  },
  buildPlan: (input, current) => ({
    action: input.action,
    ...(input.team_id ? { team_id: input.team_id } : {}),
    ...(input.command_id ? { command_id: input.command_id } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    current_snapshot: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    let result: unknown;
    switch (input.action) {
      case "create":
        result = await client.request<unknown>("POST", "/api/v4/commands", {
          body: input.payload ?? {},
        });
        break;
      case "update":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/commands/${encodeURIComponent(requireValue(input.command_id, "command_id"))}`,
          { body: input.payload ?? {} },
        );
        break;
      case "delete":
        result = await client.request<unknown>(
          "DELETE",
          `/api/v4/commands/${encodeURIComponent(requireValue(input.command_id, "command_id"))}`,
        );
        break;
      case "regen_token":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/commands/${encodeURIComponent(requireValue(input.command_id, "command_id"))}/regen_token`,
        );
        break;
    }
    recordHistory({
      tool: "infomaniak_manage_kchat_command",
      kind: "kchat_admin",
      summary: `kChat command ${input.action}${input.command_id ? ` ${input.command_id}` : ""}`,
      payload: {
        action: input.action,
        ...(input.team_id ? { team_id: input.team_id } : {}),
        ...(input.command_id ? { command_id: input.command_id } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      },
    });
    return {
      action: input.action,
      ...(input.team_id ? { team_id: input.team_id } : {}),
      ...(input.command_id ? { command_id: input.command_id } : {}),
      result,
      message: `✅ kChat command ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderMutationPlanMarkdown("kChat command", input.action, plan, token),
});

export const manageKchatBotTool = defineKchatMutationTool({
  name: "infomaniak_manage_kchat_bot",
  description:
    "Create, update, enable, disable, or delete a kChat bot. Two-phase confirmation for every mutation.",
  inputSchema: KchatBotMutationInput,
  loadCurrent: async (input) => {
    if (input.action === "create") {
      return await readKchatBots();
    }
    return await readKchatBot(requireValue(input.bot_user_id, "bot_user_id"));
  },
  buildPlan: (input, current) => ({
    action: input.action,
    ...(input.bot_user_id ? { bot_user_id: input.bot_user_id } : {}),
    ...(input.payload ? { payload: input.payload } : {}),
    current_snapshot: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    let result: unknown;
    switch (input.action) {
      case "create":
        result = await client.request<unknown>("POST", "/api/v4/bots", {
          body: input.payload ?? {},
        });
        break;
      case "update":
        result = await client.request<unknown>(
          "PUT",
          `/api/v4/bots/${encodeURIComponent(requireValue(input.bot_user_id, "bot_user_id"))}`,
          { body: input.payload ?? {} },
        );
        break;
      case "enable":
        result = await client.request<unknown>(
          "POST",
          `/api/v4/bots/${encodeURIComponent(requireValue(input.bot_user_id, "bot_user_id"))}/enable`,
        );
        break;
      case "disable":
        result = await client.request<unknown>(
          "POST",
          `/api/v4/bots/${encodeURIComponent(requireValue(input.bot_user_id, "bot_user_id"))}/disable`,
        );
        break;
      case "delete":
        result = await client.request<unknown>(
          "DELETE",
          `/api/v4/bots/${encodeURIComponent(requireValue(input.bot_user_id, "bot_user_id"))}`,
        );
        break;
    }
    recordHistory({
      tool: "infomaniak_manage_kchat_bot",
      kind: "kchat_admin",
      summary: `kChat bot ${input.action}${input.bot_user_id ? ` ${input.bot_user_id}` : ""}`,
      payload: {
        action: input.action,
        ...(input.bot_user_id ? { bot_user_id: input.bot_user_id } : {}),
        ...(input.payload ? { payload: input.payload } : {}),
      },
    });
    return {
      action: input.action,
      ...(input.bot_user_id ? { bot_user_id: input.bot_user_id } : {}),
      result,
      message: `✅ kChat bot ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderMutationPlanMarkdown("kChat bot", input.action, plan, token),
});

function defineKchatMutationTool<
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
    outputSchema: KchatMutationOutput,
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

function buildGroupPath(input: z.infer<typeof KchatGroupsInput>): {
  path: string;
  description: string;
} {
  switch (input.scope) {
    case "all":
      return { path: "/api/v4/groups", description: "all groups" };
    case "team":
      return {
        path: `/api/v4/teams/${encodeURIComponent(requireValue(input.team_id, "team_id"))}/groups`,
        description: `team ${input.team_id}`,
      };
    case "team_by_channels":
      return {
        path: `/api/v4/teams/${encodeURIComponent(requireValue(input.team_id, "team_id"))}/groups_by_channels`,
        description: `team ${input.team_id} by channels`,
      };
    case "channel":
      return {
        path: `/api/v4/channels/${encodeURIComponent(requireValue(input.channel_id, "channel_id"))}/groups`,
        description: `channel ${input.channel_id}`,
      };
    case "user":
      return {
        path: `/api/v4/users/${encodeURIComponent(requireValue(input.user_id, "user_id"))}/groups`,
        description: `user ${input.user_id}`,
      };
  }
}

async function readKchatChannels(teamId?: string): Promise<unknown[]> {
  const client = new PublicApiClient();
  if (teamId) {
    return await client.request<unknown[]>(
      "GET",
      `/api/v4/teams/${encodeURIComponent(teamId)}/channels`,
    );
  }
  return await client.request<unknown[]>("GET", "/api/v4/channels");
}

async function readKchatTeamChannels(
  teamId: string,
  visibility: "public" | "private" | "deleted",
): Promise<unknown[]> {
  const client = new PublicApiClient();
  const path =
    visibility === "public"
      ? `/api/v4/teams/${encodeURIComponent(teamId)}/channels`
      : visibility === "private"
        ? `/api/v4/teams/${encodeURIComponent(teamId)}/channels/private`
        : `/api/v4/teams/${encodeURIComponent(teamId)}/channels/deleted`;
  return await client.request<unknown[]>("GET", path);
}

async function readKchatChannel(channelId: string): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/api/v4/channels/${encodeURIComponent(channelId)}`,
  );
}

async function readKchatChannelModeration(channelId: string): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/api/v4/channels/${encodeURIComponent(channelId)}/moderations`,
  );
}

async function readKchatChannelMemberState(
  channelId: string,
  userId?: string,
): Promise<{ members: unknown[]; member?: unknown }> {
  const client = new PublicApiClient();
  const members = await client.request<unknown[]>(
    "GET",
    `/api/v4/channels/${encodeURIComponent(channelId)}/members`,
  );
  if (!userId) {
    return { members };
  }
  const member = await client.request<unknown>(
    "GET",
    `/api/v4/channels/${encodeURIComponent(channelId)}/members/${encodeURIComponent(userId)}`,
  );
  return { members, member };
}

async function readKchatGroups(
  input: z.infer<typeof KchatGroupsInput>,
): Promise<unknown[]> {
  const client = new PublicApiClient();
  const { path } = buildGroupPath(input);
  return await client.request<unknown[]>("GET", path);
}

async function readKchatBots(): Promise<unknown[]> {
  const client = new PublicApiClient();
  return await client.request<unknown[]>("GET", "/api/v4/bots");
}

async function readKchatBot(botUserId: string): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/api/v4/bots/${encodeURIComponent(botUserId)}`,
  );
}

async function readKchatCommands(teamId?: string): Promise<unknown[]> {
  const client = new PublicApiClient();
  return await client.request<unknown[]>("GET", "/api/v4/commands", {
    ...(teamId ? { query: { team_id: teamId } } : {}),
  });
}

async function readKchatCommand(commandId: string): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/api/v4/commands/${encodeURIComponent(commandId)}`,
  );
}

async function readKchatRoles(): Promise<unknown[]> {
  const client = new PublicApiClient();
  return await client.request<unknown[]>("GET", "/api/v4/roles");
}

function renderCollectionSummary(
  title: string,
  count: number,
  detail?: string,
): string {
  return [
    `# ${title}`,
    "",
    `Count: **${count}**`,
    ...(detail ? [`- ${detail}`] : []),
  ].join("\n");
}

function renderMutationPlanMarkdown(
  target: string,
  action: string,
  plan: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — ${target} ${action}`,
    "",
    `- **Action**: ${action}`,
    `- **Plan**: \`${truncateJson(plan)}\``,
    "",
    `### Next step`,
    `Re-call the same tool with the same parameters and \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function truncateJson(value: unknown): string {
  const text = JSON.stringify(value);
  if (text.length <= 500) {
    return text;
  }
  return `${text.slice(0, 497)}...`;
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`${label} is required for this action`);
  }
  return value;
}
