import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDriveActivityReportTool,
  getDriveActivitiesTool,
  manageDrivePrivateDirectoryTool,
} from "../../src/tools/kdrive-expansion.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

describe("kDrive API expansion tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("passes activity filters as repeated query parameters", async () => {
    let requestedUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return json({
        data: [{ id: 1, action: "file_create" }],
        cursor: "next",
        has_more: true,
      });
    }) as typeof fetch;

    const result = (await getDriveActivitiesTool.handler({
      drive_id: 55,
      query: {
        actions: ["file_create", "file_delete"],
        files: [10, 20],
        lang: "en",
      },
    })) as { data: unknown[]; has_more: boolean };

    const url = new URL(requestedUrl);
    expect(url.searchParams.getAll("actions")).toEqual([
      "file_create",
      "file_delete",
    ]);
    expect(url.searchParams.getAll("files")).toEqual(["10", "20"]);
    expect(result.data).toHaveLength(1);
    expect(result.has_more).toBe(true);
  });

  it("guards activity report creation with a current report snapshot", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        requests.push({ method: init?.method ?? "GET", url });
        if (url.includes("/activities/reports") && init?.method === "POST") {
          return json({ id: 9, status: "pending" }, 201);
        }
        return json({ data: [], total: 0 });
      },
    ) as typeof fetch;

    const plan = (await createDriveActivityReportTool.handler({
      drive_id: 55,
      lang: "en",
      payload: { actions: ["file_share_create"] },
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");

    const applied = (await createDriveActivityReportTool.handler({
      drive_id: 55,
      lang: "en",
      payload: { actions: ["file_share_create"] },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
  });

  it("guards private-directory policy updates", async () => {
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
        return json({ size_threshold: 1000 });
      },
    ) as typeof fetch;

    const plan = (await manageDrivePrivateDirectoryTool.handler({
      drive_id: 55,
      size_threshold: 5000,
    })) as { status: "plan"; confirmation_token: string };

    await manageDrivePrivateDirectoryTool.handler({
      drive_id: 55,
      size_threshold: 5000,
      confirmation_token: plan.confirmation_token,
    });

    expect(requests[2]).toMatchObject({
      method: "PUT",
      url: expect.stringContaining("/2/drive/55/settings/files/private"),
      body: { size_threshold: 5000 },
    });
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
