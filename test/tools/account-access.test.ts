import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditAccountAccessTool,
  cancelPendingInvitationsTool,
  getUserAppAccessesTool,
  listAccountUsersTool,
  planUserOffboardingTool,
} from "../../src/tools/account-access.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
}

describe("account access admin tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists account users through the public user-management endpoint", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return new Response(
          JSON.stringify({
            result: "success",
            data: [
              { id: 10, email: "admin@example.com", display_name: "Admin" },
              { id: 20, email: "user@example.com", display_name: "User" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    ) as typeof fetch;

    const result = (await listAccountUsersTool.handler({
      account_id: 123,
    })) as {
      account_id: number;
      count: number;
      users: unknown[];
    };

    expect(result.account_id).toBe(123);
    expect(result.count).toBe(2);
    expect(requests).toEqual([
      {
        method: "GET",
        url: expect.stringContaining("/2/accounts/123/users"),
      },
    ]);
  });

  it("gets app accesses for one account user", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return new Response(
          JSON.stringify({
            result: "success",
            data: [{ app: "mail", role: "admin" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    ) as typeof fetch;

    const result = (await getUserAppAccessesTool.handler({
      account_id: 123,
      user_id: 20,
    })) as { account_id: number; user_id: number; app_accesses: unknown[] };

    expect(result).toMatchObject({
      account_id: 123,
      user_id: 20,
      app_accesses: [{ app: "mail", role: "admin" }],
    });
    expect(requests[0]?.url).toContain("/2/accounts/123/users/20/app_accesses");
  });

  it("builds a read-only initial offboarding plan from app accesses and invitations", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        if (url.includes("/app_accesses")) {
          return new Response(
            JSON.stringify({
              result: "success",
              data: [
                { app: "mail", role: "admin" },
                { app: "drive", role: "user" },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            result: "success",
            data: [{ id: 77, status: "pending" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    ) as typeof fetch;

    const result = (await planUserOffboardingTool.handler({
      account_id: 123,
      user_id: 20,
    })) as {
      status: "plan";
      actions: Array<{ action: string; reason: string }>;
      app_accesses: unknown[];
      invitations: unknown[];
    };

    expect(result.status).toBe("plan");
    expect(result.app_accesses).toHaveLength(2);
    expect(result.invitations).toHaveLength(1);
    expect(result.actions.map((action) => action.action)).toEqual(
      expect.arrayContaining([
        "review_app_accesses",
        "cancel_pending_invitations",
        "inspect_mailbox_access",
        "inspect_drive_access",
      ]),
    );
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
  });

  it("audits account access across users and highlights admin-like access", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });

        if (url.includes("/2/accounts/123/users/10/app_accesses")) {
          return json([
            { app: "mail", role: "admin" },
            { app: "drive", role: "manager" },
          ]);
        }
        if (url.includes("/2/accounts/123/users/20/app_accesses")) {
          return json([{ app: "drive", role: "user" }]);
        }
        return json([
          { id: 10, email: "admin@example.com", display_name: "Admin" },
          { id: 20, email: "user@example.com", display_name: "User" },
        ]);
      },
    ) as typeof fetch;

    const result = (await auditAccountAccessTool.handler({
      account_id: 123,
    })) as {
      account_id: number;
      summary: { users: number; app_accesses: number };
      findings: Array<{ category: string; severity: string; user_id?: number }>;
    };

    expect(result.account_id).toBe(123);
    expect(result.summary).toMatchObject({
      users: 2,
      app_accesses: 3,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "privileged_access",
          severity: "warning",
          user_id: 10,
        }),
      ]),
    );
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
  });

  it("cancels only pending invitations through two-phase confirmation", async () => {
    const requests: Array<RecordedRequest & { body?: unknown }> = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const request: RecordedRequest & { body?: unknown } = {
          method: init?.method ?? "GET",
          url,
        };
        if (init?.body !== undefined) {
          request.body = JSON.parse(String(init.body));
        }
        requests.push(request);

        if (request.method === "DELETE") {
          return json(true);
        }
        return json([
          { id: 77, status: "pending", email: "person@example.com" },
          { id: 78, status: "accepted", email: "old@example.com" },
          { invitation: 79, state: "pending", email: "other@example.com" },
        ]);
      },
    ) as typeof fetch;

    const plan = (await cancelPendingInvitationsTool.handler({
      account_id: 123,
      user_id: 20,
    })) as {
      status: "plan";
      confirmation_token: string;
      pending_invitations: Array<{ invitation_id: number }>;
    };

    expect(plan.status).toBe("plan");
    expect(
      plan.pending_invitations.map((invitation) => invitation.invitation_id),
    ).toEqual([77, 79]);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await cancelPendingInvitationsTool.handler({
      account_id: 123,
      user_id: 20,
      confirmation_token: plan.confirmation_token,
    })) as {
      status: "applied";
      canceled: Array<{ invitation_id: number; status: string }>;
      skipped: Array<{ invitation_id: number; reason: string }>;
    };

    expect(applied.canceled).toEqual([
      { invitation_id: 77, status: "canceled" },
      { invitation_id: 79, status: "canceled" },
    ]);
    expect(applied.skipped).toEqual([
      { invitation_id: 78, reason: "not_pending" },
    ]);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain("/1/accounts/123/invitations/77");
    expect(requests[3]?.url).toContain("/1/accounts/123/invitations/79");
  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
