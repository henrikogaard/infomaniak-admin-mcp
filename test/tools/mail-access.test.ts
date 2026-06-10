import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMailAccessTool,
  manageMailAccessTool,
} from "../../src/tools/mail-access.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("mail access tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists mailbox webmail users without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return ok([
          { user_id: 77, email: "manager@example.com", role: "admin" },
          { user_id: 88, email: "delegate@example.com", role: "viewer" },
        ]);
      },
    ) as typeof fetch;

    const result = (await getMailAccessTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "users",
    })) as {
      action: string;
      result: Array<{ user_id: number; email: string }>;
    };

    expect(result.action).toBe("users");
    expect(result.result).toHaveLength(2);
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.infomaniak.com/1/mail_hostings/55/mailboxes/info/accesses/webmail/users",
      },
    ]);
  });

  it("plans and applies a mailbox webmail user update through two-phase confirmation", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const request: RecordedRequest = { method: init?.method ?? "GET", url };
        if (init?.body !== undefined) {
          request.body = JSON.parse(String(init.body));
        }
        requests.push(request);

        if (request.method === "GET") {
          return ok([
            { user_id: 77, email: "manager@example.com", role: "admin" },
          ]);
        }
        if (request.method === "PATCH") {
          return ok({
            user_id: 77,
            email: "manager@example.com",
            role: "manager",
          });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageMailAccessTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "update_user",
      user_id: 77,
      payload: { role: "manager" },
    })) as {
      status: "plan";
      confirmation_token: string;
      current: unknown;
      mutation: { path: string; method: string };
    };

    expect(plan.status).toBe("plan");
    expect(plan.mutation.path).toBe(
      "/1/mail_hostings/55/mailboxes/info/accesses/webmail/users/77",
    );

    const applied = (await manageMailAccessTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "update_user",
      user_id: 77,
      payload: { role: "manager" },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; result: { role: string } };

    expect(applied.status).toBe("applied");
    expect(applied.result).toEqual({
      user_id: 77,
      email: "manager@example.com",
      role: "manager",
    });
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[2]?.body).toEqual({ role: "manager" });
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
