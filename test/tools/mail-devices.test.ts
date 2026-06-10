import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMailDevicesTool,
  manageMailDevicesTool,
} from "../../src/tools/mail-devices.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("mail device tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists device access for a mailbox user", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return ok([{ id: 11, name: "iPhone", last_seen_at: 1_700_000_000 }]);
      },
    ) as typeof fetch;

    const result = (await getMailDevicesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "list_user",
      user_id: 77,
    })) as {
      action: string;
      result: Array<{ id: number; name: string }>;
    };

    expect(result.action).toBe("list_user");
    expect(result.result).toHaveLength(1);
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.infomaniak.com/1/mail_hostings/55/mailboxes/info/accesses/devices/users/77",
      },
    ]);
  });

  it("plans and applies removing a mailbox user's device access", async () => {
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
          return ok([{ id: 11, name: "iPhone" }]);
        }
        if (request.method === "DELETE") {
          return ok({ removed: true });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageMailDevicesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "delete_user_device",
      user_id: 77,
      device_access: 11,
    })) as {
      status: "plan";
      confirmation_token: string;
      mutation: { path: string };
    };

    expect(plan.status).toBe("plan");
    expect(plan.mutation.path).toBe(
      "/1/mail_hostings/55/mailboxes/info/accesses/devices/11",
    );

    const applied = (await manageMailDevicesTool.handler({
      mail_hosting_id: 55,
      mailbox_name: "info",
      action: "delete_user_device",
      user_id: 77,
      device_access: 11,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; result: { removed: boolean } };

    expect(applied.status).toBe("applied");
    expect(applied.result).toEqual({ removed: true });
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toBe(
      "https://api.infomaniak.com/1/mail_hostings/55/mailboxes/info/accesses/devices/11",
    );
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
