import { afterEach, describe, expect, it, vi } from "vitest";

import {
  manageMailboxAliasesTool,
  manageMailboxAutoReplyTool,
  manageMailboxForwardingTool,
  manageServiceRedirectionsTool,
  rotateMailDkimTool,
} from "../../src/tools/mail-admin.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("deeper mail administration tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("replaces mailbox aliases through a guarded two-phase flow", async () => {
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
          return ok({ aliases: ["info", "sales"] });
        }
        if (request.method === "PUT") {
          return ok({ aliases: ["info", "team"] });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageMailboxAliasesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "replace",
      aliases: ["info", "team"],
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await manageMailboxAliasesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "replace",
      aliases: ["info", "team"],
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/55/mailboxes/info/aliases",
    );
    expect(requests[2]?.body).toEqual({ aliases: ["info", "team"] });
  });

  it("deletes a mailbox forwarding address after a fresh snapshot check", async () => {
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
          return ok([{ forwarding_address: "spam@example.net" }]);
        }
        if (request.method === "DELETE") {
          return ok(true);
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageMailboxForwardingTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "delete",
      forwarding_address: "spam@example.net",
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await manageMailboxForwardingTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "delete",
      forwarding_address: "spam@example.net",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/55/mailboxes/info/forwarding_addresses/spam%40example.net",
    );
  });

  it("resets a mailbox auto-reply model with two-phase confirmation", async () => {
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
          return ok([{ id: 1, subject: "OOO" }]);
        }
        if (request.method === "PUT") {
          return ok({ reset: true });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageMailboxAutoReplyTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "reset",
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await manageMailboxAutoReplyTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "reset",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/55/mailboxes/info/auto_reply/reset",
    );
  });

  it("resends service redirection confirmations through a guarded apply", async () => {
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
          return ok([{ id: 11, name: "support@example.com" }]);
        }
        if (request.method === "PUT") {
          return ok({ sent: true });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageServiceRedirectionsTool.handler({
      mail_hosting_id: 55,
      action: "resend_confirmation",
      redirection_id: 11,
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await manageServiceRedirectionsTool.handler({
      mail_hosting_id: 55,
      action: "resend_confirmation",
      redirection_id: 11,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/55/redirections/11/send-confirmation-requests",
    );
  });

  it("rotates DKIM after a confirming plan step", async () => {
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
          return ok({ rotate: true });
        }
        if (request.method === "POST") {
          return ok({ rotated: true });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await rotateMailDkimTool.handler({
      mail_hosting_id: 55,
      action: "rotate",
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    const applied = (await rotateMailDkimTool.handler({
      mail_hosting_id: 55,
      action: "rotate",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/55/diagnostic/dkim/rotate",
    );
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
