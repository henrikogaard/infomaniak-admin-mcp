import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getKchatBotTool,
  getKchatChannelModerationTool,
  getKchatChannelTool,
  getKchatCommandTool,
  listKchatBotsTool,
  listKchatChannelMembersTool,
  listKchatChannelsTool,
  listKchatCommandsTool,
  listKchatGroupsTool,
  listKchatRolesTool,
  listKchatTeamChannelsTool,
  manageKchatBotTool,
  manageKchatChannelMembersTool,
  manageKchatChannelTool,
  manageKchatCommandTool,
} from "../../src/tools/kchat-admin.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("kChat governance tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists channels, team channels, groups, bots, commands, and roles for admin review", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });

        if (url.endsWith("/api/v4/channels")) return ok([{ id: "ch-1" }]);
        if (url.endsWith("/api/v4/teams/team-1/channels"))
          return ok([{ id: "team-public" }]);
        if (url.endsWith("/api/v4/teams/team-1/channels/private"))
          return ok([{ id: "team-private" }]);
        if (url.endsWith("/api/v4/teams/team-1/channels/deleted"))
          return ok([{ id: "team-deleted" }]);
        if (url.endsWith("/api/v4/channels/ch-1"))
          return ok({ id: "ch-1", name: "ops" });
        if (url.endsWith("/api/v4/channels/ch-1/members"))
          return ok([{ id: "u-1" }]);
        if (url.endsWith("/api/v4/channels/ch-1/members/u-1"))
          return ok({ id: "u-1", roles: "channel_user" });
        if (url.endsWith("/api/v4/channels/ch-1/moderations"))
          return ok({ id: "mod-1" });
        if (url.endsWith("/api/v4/groups")) return ok([{ id: "g-1" }]);
        if (url.endsWith("/api/v4/teams/team-1/groups"))
          return ok([{ id: "g-1" }]);
        if (url.endsWith("/api/v4/bots")) return ok([{ id: "bot-1" }]);
        if (url.endsWith("/api/v4/bots/bot-1"))
          return ok({ id: "bot-1", username: "ops-bot" });
        if (url.includes("/api/v4/commands?")) return ok([{ id: "cmd-1" }]);
        if (url.endsWith("/api/v4/commands/cmd-1"))
          return ok({ id: "cmd-1", trigger: "ops" });
        if (url.endsWith("/api/v4/roles")) return ok([{ id: "role-1" }]);
        return ok({});
      },
    ) as typeof fetch;

    const channels = (await listKchatChannelsTool.handler({
      team_id: "team-1",
    })) as {
      items: unknown[];
    };
    const teamChannels = (await listKchatTeamChannelsTool.handler({
      team_id: "team-1",
      visibility: "private",
    })) as { items: unknown[] };
    const groups = (await listKchatGroupsTool.handler({
      scope: "team",
      team_id: "team-1",
    })) as {
      items: unknown[];
    };
    const bots = (await listKchatBotsTool.handler({})) as { items: unknown[] };
    const commands = (await listKchatCommandsTool.handler({
      team_id: "team-1",
    })) as {
      items: unknown[];
    };
    const roles = (await listKchatRolesTool.handler({})) as {
      items: unknown[];
    };
    const channel = (await getKchatChannelTool.handler({
      channel_id: "ch-1",
    })) as {
      item: Record<string, unknown>;
    };
    const members = (await listKchatChannelMembersTool.handler({
      channel_id: "ch-1",
      user_id: "u-1",
    })) as { members: unknown[]; member?: Record<string, unknown> };
    const moderation = (await getKchatChannelModerationTool.handler({
      channel_id: "ch-1",
    })) as {
      item: Record<string, unknown>;
    };
    const bot = (await getKchatBotTool.handler({ bot_user_id: "bot-1" })) as {
      item: Record<string, unknown>;
    };
    const command = (await getKchatCommandTool.handler({
      command_id: "cmd-1",
    })) as {
      item: Record<string, unknown>;
    };

    expect(channels.items).toHaveLength(1);
    expect(teamChannels.items).toHaveLength(1);
    expect(groups.items).toHaveLength(1);
    expect(bots.items).toHaveLength(1);
    expect(commands.items).toHaveLength(1);
    expect(roles.items).toHaveLength(1);
    expect(channel.item).toMatchObject({ id: "ch-1" });
    expect(members.member).toMatchObject({ id: "u-1" });
    expect(moderation.item).toMatchObject({ id: "mod-1" });
    expect(bot.item).toMatchObject({ id: "bot-1" });
    expect(command.item).toMatchObject({ id: "cmd-1" });
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("patches and deletes a channel through a guarded two-phase flow", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const request: RecordedRequest = { method: init?.method ?? "GET", url };
        if (init?.body !== undefined) {
          request.body = JSON.parse(String(init.body));
        }
        requests.push(request);

        if (url.endsWith("/api/v4/channels/ch-1") && request.method === "GET")
          return ok({ id: "ch-1" });
        if (
          url.endsWith("/api/v4/channels/ch-1/patch") &&
          request.method === "PUT"
        ) {
          return ok({ id: "ch-1", display_name: "Ops" });
        }
        if (url.endsWith("/api/v4/channels/ch-2") && request.method === "GET")
          return ok({ id: "ch-2" });
        if (
          url.endsWith("/api/v4/channels/ch-2") &&
          request.method === "DELETE"
        )
          return ok(true);
        return ok({});
      },
    ) as typeof fetch;

    const patchPlan = (await manageKchatChannelTool.handler({
      action: "patch",
      channel_id: "ch-1",
      payload: { display_name: "Ops" },
    })) as { status: "plan"; confirmation_token: string };

    const patchApplied = (await manageKchatChannelTool.handler({
      action: "patch",
      channel_id: "ch-1",
      payload: { display_name: "Ops" },
      confirmation_token: patchPlan.confirmation_token,
    })) as { status: "applied"; message: string };

    const deletePlan = (await manageKchatChannelTool.handler({
      action: "delete",
      channel_id: "ch-2",
    })) as { status: "plan"; confirmation_token: string };

    const deleteApplied = (await manageKchatChannelTool.handler({
      action: "delete",
      channel_id: "ch-2",
      confirmation_token: deletePlan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(patchApplied.status).toBe("applied");
    expect(deleteApplied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain("/api/v4/channels/ch-1/patch");
    expect(requests[5]?.url).toContain("/api/v4/channels/ch-2");
  });

  it("updates channel members, commands, and bots with confirmation tokens", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const request: RecordedRequest = { method: init?.method ?? "GET", url };
        if (init?.body !== undefined) {
          request.body = JSON.parse(String(init.body));
        }
        requests.push(request);

        if (
          url.includes("/api/v4/channels/ch-1/members") &&
          request.method === "GET"
        )
          return ok([{ id: "u-1" }]);
        if (
          url.includes("/api/v4/channels/ch-1/members/u-1") &&
          request.method === "GET"
        ) {
          return ok({ id: "u-1", roles: "channel_user" });
        }
        if (
          url.endsWith("/api/v4/channels/ch-1/members") &&
          request.method === "POST"
        )
          return ok([{ id: "u-2" }]);
        if (
          url.endsWith("/api/v4/channels/ch-1/members/u-1/roles") &&
          request.method === "PUT"
        ) {
          return ok({ id: "u-1", roles: "channel_admin" });
        }
        if (url.endsWith("/api/v4/commands/cmd-1") && request.method === "GET")
          return ok({ id: "cmd-1" });
        if (
          url.endsWith("/api/v4/commands/cmd-1/regen_token") &&
          request.method === "PUT"
        ) {
          return ok({ id: "cmd-1", token: "new-token" });
        }
        if (url.endsWith("/api/v4/bots/bot-1") && request.method === "GET")
          return ok({ id: "bot-1" });
        if (
          url.endsWith("/api/v4/bots/bot-1/disable") &&
          request.method === "POST"
        )
          return ok({ id: "bot-1", active: false });
        return ok({});
      },
    ) as typeof fetch;

    const addPlan = (await manageKchatChannelMembersTool.handler({
      action: "add",
      channel_id: "ch-1",
      user_ids: ["u-2"],
    })) as { status: "plan"; confirmation_token: string };
    const addApplied = (await manageKchatChannelMembersTool.handler({
      action: "add",
      channel_id: "ch-1",
      user_ids: ["u-2"],
      confirmation_token: addPlan.confirmation_token,
    })) as { status: "applied" };

    const rolesPlan = (await manageKchatChannelMembersTool.handler({
      action: "update_roles",
      channel_id: "ch-1",
      user_id: "u-1",
      roles: "channel_admin",
    })) as { status: "plan"; confirmation_token: string };
    const rolesApplied = (await manageKchatChannelMembersTool.handler({
      action: "update_roles",
      channel_id: "ch-1",
      user_id: "u-1",
      roles: "channel_admin",
      confirmation_token: rolesPlan.confirmation_token,
    })) as { status: "applied" };

    const commandPlan = (await manageKchatCommandTool.handler({
      action: "regen_token",
      command_id: "cmd-1",
    })) as { status: "plan"; confirmation_token: string };
    const commandApplied = (await manageKchatCommandTool.handler({
      action: "regen_token",
      command_id: "cmd-1",
      confirmation_token: commandPlan.confirmation_token,
    })) as { status: "applied" };

    const botPlan = (await manageKchatBotTool.handler({
      action: "disable",
      bot_user_id: "bot-1",
    })) as { status: "plan"; confirmation_token: string };
    const botApplied = (await manageKchatBotTool.handler({
      action: "disable",
      bot_user_id: "bot-1",
      confirmation_token: botPlan.confirmation_token,
    })) as { status: "applied" };

    expect(addApplied.status).toBe("applied");
    expect(rolesApplied.status).toBe("applied");
    expect(commandApplied.status).toBe("applied");
    expect(botApplied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
      "GET",
      "GET",
      "GET",
      "GET",
      "PUT",
      "GET",
      "GET",
      "PUT",
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.body).toEqual({ user_ids: ["u-2"] });
    expect(requests[7]?.body).toEqual({ roles: "channel_admin" });
    expect(requests[10]?.url).toContain("/api/v4/commands/cmd-1/regen_token");
    expect(requests[13]?.url).toContain("/api/v4/bots/bot-1/disable");
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
