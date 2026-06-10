import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getNewsletterAdminTool,
  manageNewsletterAdminTool,
} from "../../src/tools/newsletters.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("newsletter admin tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists newsletter groups without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return ok([
          { id: 1, name: "Customers" },
          { id: 2, name: "Security" },
        ]);
      },
    ) as typeof fetch;

    const result = (await getNewsletterAdminTool.handler({
      domain: "example.com",
      action: "groups",
    })) as {
      action: string;
      result: Array<{ id: number; name: string }>;
    };

    expect(result.action).toBe("groups");
    expect(result.result).toHaveLength(2);
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.infomaniak.com/1/newsletters/example.com/groups",
      },
    ]);
  });

  it("plans and applies newsletter group creation through two-phase confirmation", async () => {
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
          return ok([{ id: 1, name: "Customers" }]);
        }
        if (request.method === "POST") {
          return ok({ id: 3, name: "Events" });
        }
        return ok({});
      },
    ) as typeof fetch;

    const plan = (await manageNewsletterAdminTool.handler({
      domain: "example.com",
      action: "create_group",
      payload: { name: "Events" },
    })) as {
      status: "plan";
      confirmation_token: string;
      mutation: { path: string; method: string };
    };

    expect(plan.status).toBe("plan");
    expect(plan.mutation.path).toBe("/1/newsletters/example.com/groups");

    const applied = (await manageNewsletterAdminTool.handler({
      domain: "example.com",
      action: "create_group",
      payload: { name: "Events" },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; result: { id: number; name: string } };

    expect(applied.status).toBe("applied");
    expect(applied.result).toEqual({ id: 3, name: "Events" });
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.body).toEqual({ name: "Events" });
  });
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
