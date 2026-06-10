import { afterEach, describe, expect, it, vi } from "vitest";

import {
  addAccountTeamUsersTool,
  createAccountInvitationTool,
  deleteAccountTagTool,
  updateAccountTeamTool,
} from "../../src/tools/account-admin.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("account governance write tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("plans and applies account invitation creation with a fresh account snapshot", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const request: RecordedRequest = { method: init?.method ?? "GET", url };
        if (init?.body !== undefined) {
          request.body = JSON.parse(String(init.body));
        }
        requests.push(request);

        if (url.includes("/2/accounts/123/users"))
          return ok([{ id: 1, email: "admin@example.com" }]);
        if (url.includes("/1/accounts/123/teams"))
          return ok([{ id: 10, name: "Owners" }]);
        if (url.includes("/1/accounts/123/tags"))
          return ok([{ id: 20, name: "VIP" }]);
        if (
          url.includes("/1/accounts/123/invitations") &&
          request.method === "POST"
        ) {
          return ok({ id: 77, status: "pending" });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await createAccountInvitationTool.handler({
      account_id: 123,
      payload: { email: "new@example.com", role: "admin" },
    })) as {
      status: "plan";
      confirmation_token: string;
      account_id: number;
      action: string;
    };

    expect(plan.status).toBe("plan");
    expect(plan.account_id).toBe(123);
    expect(plan.action).toBe("create_invitation");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);

    const applied = (await createAccountInvitationTool.handler({
      account_id: 123,
      payload: { email: "new@example.com", role: "admin" },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(applied.message).toContain("created");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[6]?.url).toContain("/1/accounts/123/invitations");
    expect(requests[6]?.body).toEqual({
      email: "new@example.com",
      role: "admin",
    });
  });

  it("updates account team membership through a guarded two-phase flow", async () => {
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
          url.includes("/1/accounts/123/teams/10") &&
          request.method === "GET"
        ) {
          return ok({ id: 10, name: "Owners", user_count: 1 });
        }
        if (
          url.includes("/1/accounts/123/teams/10") &&
          request.method === "PATCH"
        ) {
          return ok({ id: 10, name: "Owners", user_count: 2 });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await updateAccountTeamTool.handler({
      account_id: 123,
      team_id: 10,
      payload: { name: "Owners", description: "Updated team" },
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await updateAccountTeamTool.handler({
      account_id: 123,
      team_id: 10,
      payload: { name: "Owners", description: "Updated team" },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[2]?.body).toEqual({
      name: "Owners",
      description: "Updated team",
    });
  });

  it("deletes an account tag after checking the current tag list", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const request: RecordedRequest = { method: init?.method ?? "GET", url };
        if (init?.body !== undefined) {
          request.body = JSON.parse(String(init.body));
        }
        requests.push(request);

        if (url.includes("/1/accounts/123/tags") && request.method === "GET") {
          return ok([
            { id: 20, name: "VIP" },
            { id: 21, name: "Ops" },
          ]);
        }
        if (
          url.includes("/1/accounts/123/tags/20") &&
          request.method === "DELETE"
        ) {
          return ok(true);
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await deleteAccountTagTool.handler({
      account_id: 123,
      tag_id: 20,
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await deleteAccountTagTool.handler({
      account_id: 123,
      tag_id: 20,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain("/1/accounts/123/tags/20");
  });

  it("adds users to a team through the same two-phase contract", async () => {
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
          url.includes("/1/accounts/123/teams/10/users") &&
          request.method === "GET"
        ) {
          return ok([{ id: 2, email: "user@example.com" }]);
        }
        if (
          url.includes("/1/accounts/123/teams/10/users") &&
          request.method === "POST"
        ) {
          return ok([
            { id: 2, email: "user@example.com" },
            { id: 3, email: "new@example.com" },
          ]);
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await addAccountTeamUsersTool.handler({
      account_id: 123,
      team_id: 10,
      payload: { user_ids: [2, 3] },
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await addAccountTeamUsersTool.handler({
      account_id: 123,
      team_id: 10,
      payload: { user_ids: [2, 3] },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.body).toEqual({ user_ids: [2, 3] });
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
