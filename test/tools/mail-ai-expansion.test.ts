import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emptyMailboxTrashTool,
  listEmailImportsTool,
  manageMailboxFilterLifecycleTool,
} from "../../src/tools/mail-expansion.js";
import {
  getAiBatchResultTool,
  getAiConsumptionsTool,
} from "../../src/tools/ai-expansion.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

describe("mail and AI API expansion tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists mailbox email-import history", async () => {
    let requestedUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return json([{ id: 1, state: "finished" }]);
    }) as typeof fetch;

    const result = (await listEmailImportsTool.handler({
      mail_hosting_id: 12,
      mailbox_name: "info",
      query: { search: "2026", page: 2 },
    })) as { imports: unknown[] };

    expect(requestedUrl).toContain("/1/mail_hostings/12/mailboxes/info/email_imports");
    expect(requestedUrl).toContain("search=2026");
    expect(result.imports).toHaveLength(1);
  });

  it("guards filter activation changes", async () => {
    const requests: Array<{ method: string; url: string; body?: unknown }> = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
        });
        if (init?.method === "PUT") return json(true);
        return json({ filters: [{ name: "Forward invoices", is_enabled: true }] });
      },
    ) as typeof fetch;

    const plan = (await manageMailboxFilterLifecycleTool.handler({
      mail_hosting_id: 12,
      mailbox_name: "info",
      action: "set_activation",
      filter_name: "Forward invoices",
      is_enabled: false,
    })) as { status: "plan"; confirmation_token: string };

    await manageMailboxFilterLifecycleTool.handler({
      mail_hosting_id: 12,
      mailbox_name: "info",
      action: "set_activation",
      filter_name: "Forward invoices",
      is_enabled: false,
      confirmation_token: plan.confirmation_token,
    });

    expect(requests[2]).toMatchObject({
      method: "PUT",
      url: expect.stringContaining("/auth/filters/set_activation"),
      body: { name: "Forward invoices", is_enabled: false },
    });
  });

  it("guards emptying a mailbox trash folder", async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "DELETE") return json(true);
      return json({ count: 14 });
    }) as typeof fetch;

    const plan = (await emptyMailboxTrashTool.handler({
      mail_hosting_id: 12,
      mailbox_name: "info",
    })) as { status: "plan"; confirmation_token: string };
    await emptyMailboxTrashTool.handler({
      mail_hosting_id: 12,
      mailbox_name: "info",
      confirmation_token: plan.confirmation_token,
    });

    expect(methods).toEqual(["GET", "GET", "DELETE"]);
  });

  it("reads AI consumption and batch-result endpoints", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json({ items: [{ id: 1 }] });
    }) as typeof fetch;

    await getAiConsumptionsTool.handler({ product_id: 44, query: { page: 2 } });
    await getAiBatchResultTool.handler({ product_id: 44, batch_id: "batch-1", download: true });

    expect(urls[0]).toContain("/1/ai/44/consumptions?page=2");
    expect(urls[1]).toContain("/1/ai/44/results/batch-1/download");
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
