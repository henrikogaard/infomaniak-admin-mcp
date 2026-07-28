import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAccountResourcesTool,
  manageAccountB2bTool,
  getDomainResourcesTool,
  manageDomainNameserversTool,
} from "../../src/tools/account-domain-expansion.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

describe("account and domain API expansion tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("reads account product inventory and team drill-down resources", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json([{ id: 1 }]);
    }) as typeof fetch;

    const result = (await getAccountResourcesTool.handler({
      resource: "list_products",
      account_id: 123,
    })) as { data: unknown[] };

    expect(urls[0]).toContain("/1/accounts/123/products");
    expect(result.data).toHaveLength(1);
  });

  it("guards B2B invitation assignments", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ method: init?.method ?? "GET", url: String(input) });
      if (init?.method === "POST") return json({ partnership_id: 88 });
      return json([{ partnership_id: 88 }]);
    }) as typeof fetch;

    const plan = (await manageAccountB2bTool.handler({
      account_id: 123,
      invitation_id: 77,
      action: "assign",
      payload: { customer_id: 456 },
    })) as { status: "plan"; confirmation_token: string };

    await manageAccountB2bTool.handler({
      account_id: 123,
      invitation_id: 77,
      action: "assign",
      payload: { customer_id: 456 },
      confirmation_token: plan.confirmation_token,
    });

    expect(requests.map((request) => request.method)).toEqual(["GET", "GET", "POST"]);
    expect(requests[2]?.url).toContain("/invitations/77/b2b");
  });

  it("uses the canonical v2 domain and DNS record paths", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json({ id: 10 });
    }) as typeof fetch;

    await getDomainResourcesTool.handler({ resource: "get_domain", domain: "example.com" });
    await getDomainResourcesTool.handler({ resource: "get_record", zone: "example.com", record_id: 10 });

    expect(urls[0]).toContain("/2/domains/domains/example.com");
    expect(urls[1]).toContain("/2/zones/example.com/records/10");
  });

  it("guards nameserver updates", async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "PUT") return json(true);
      return json({ nameservers: ["ns1.old.example"] });
    }) as typeof fetch;

    const plan = (await manageDomainNameserversTool.handler({
      domain: "example.com",
      nameservers: ["ns1.example.net", "ns2.example.net"],
    })) as { status: "plan"; confirmation_token: string };

    await manageDomainNameserversTool.handler({
      domain: "example.com",
      nameservers: ["ns1.example.net", "ns2.example.net"],
      confirmation_token: plan.confirmation_token,
    });

    expect(methods).toEqual(["GET", "GET", "PUT"]);
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
