import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMailSignaturesTool,
  manageMailSignaturesTool,
} from "../../src/tools/mail-signatures.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("mail signature tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists mailbox signatures without requiring confirmation", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return ok([
          { id: "primary", name: "Primary", is_default: true },
          { id: "legal", name: "Legal", is_default: false },
        ]);
      },
    ) as typeof fetch;

    const result = (await getMailSignaturesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      scope: "mailbox",
      resource: "signature",
      action: "list",
    })) as {
      scope: string;
      resource: string;
      action: string;
      result: Array<{ id: string; name: string }>;
    };

    expect(result.scope).toBe("mailbox");
    expect(result.resource).toBe("signature");
    expect(result.action).toBe("list");
    expect(result.result).toHaveLength(2);
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.infomaniak.com/1/mail_hostings/55/mailboxes/info/signatures",
      },
    ]);
  });

  it("plans and applies mailbox signature deletion with a fresh snapshot", async () => {
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
          return ok([{ id: "primary", name: "Primary" }]);
        }
        if (request.method === "DELETE") {
          return ok({ deleted: true });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageMailSignaturesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      scope: "mailbox",
      resource: "signature",
      action: "delete",
      signature_id: "primary",
    })) as {
      status: "plan";
      confirmation_token: string;
      current: unknown;
      mutation: { path: string; method: string };
    };

    expect(plan.status).toBe("plan");
    expect(plan.mutation.path).toBe(
      "/1/mail_hostings/55/mailboxes/info/signatures/primary",
    );
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await manageMailSignaturesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      scope: "mailbox",
      resource: "signature",
      action: "delete",
      signature_id: "primary",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string; result: { deleted: boolean } };

    expect(applied.status).toBe("applied");
    expect(applied.result).toEqual({ deleted: true });
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toBe(
      "https://api.infomaniak.com/1/mail_hostings/55/mailboxes/info/signatures/primary",
    );
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
