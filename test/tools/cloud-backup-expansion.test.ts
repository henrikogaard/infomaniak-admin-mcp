import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listPublicCloudProjectsTool,
  listPublicCloudResourceDataTool,
  managePublicCloudDatabaseServiceTool,
  managePublicCloudProjectTool,
} from "../../src/tools/public-cloud.js";
import {
  getSwissBackupTool,
  listSwissBackupSlotsTool,
  manageSwissBackupSlotTool,
} from "../../src/tools/swiss-backup-expansion.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

describe("Public Cloud and Swiss Backup API expansion tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("lists Public Cloud projects and catalog data", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json([{ id: 1 }]);
    }) as typeof fetch;

    await listPublicCloudProjectsTool.handler({ public_cloud_id: 7 });
    await listPublicCloudResourceDataTool.handler({ resource: "dbaas_regions" });

    expect(urls[0]).toContain("/1/public_clouds/7/projects");
    expect(urls[1]).toContain("/1/public_clouds/dbaas/regions");
  });

  it("guards Public Cloud project creation", async () => {
    const methods: string[] = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      if (init?.method === "POST") return json({ id: 10 });
      return json([]);
    }) as typeof fetch;

    const plan = (await managePublicCloudProjectTool.handler({
      public_cloud_id: 7,
      action: "create",
      payload: { name: "Production" },
    })) as { status: "plan"; confirmation_token: string };

    await managePublicCloudProjectTool.handler({
      public_cloud_id: 7,
      action: "create",
      payload: { name: "Production" },
      confirmation_token: plan.confirmation_token,
    });

    expect(methods).toEqual(["GET", "GET", "POST"]);
  });

  it("targets DBaaS operational actions at the service id", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      urls.push(String(input));
      return init?.method === "POST" ? json(true) : json({ id: 9 });
    }) as typeof fetch;

    const plan = (await managePublicCloudDatabaseServiceTool.handler({
      public_cloud_id: 7,
      project_id: 8,
      dbaas_id: 9,
      action: "reset_password",
      payload: {},
    })) as { confirmation_token: string };

    await managePublicCloudDatabaseServiceTool.handler({
      public_cloud_id: 7,
      project_id: 8,
      dbaas_id: 9,
      action: "reset_password",
      payload: {},
      confirmation_token: plan.confirmation_token,
    });

    expect(urls[2]).toContain("/dbaas/9/reset_password");
  });

  it("reads Swiss Backup detail and slots", async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return json([{ id: 3 }]);
    }) as typeof fetch;

    await getSwissBackupTool.handler({ swiss_backup_id: 4 });
    await listSwissBackupSlotsTool.handler({ swiss_backup_id: 4 });

    expect(urls[0]).toContain("/1/swiss_backups/4");
    expect(urls[1]).toContain("/1/swiss_backups/4/slots");
  });

  it("guards Swiss Backup slot enable/disable operations", async () => {
    const methods: string[] = [];
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? "GET");
      urls.push(String(input));
      if (init?.method === "POST") return json(true);
      return json([{ id: 3, enabled: true }]);
    }) as typeof fetch;

    const plan = (await manageSwissBackupSlotTool.handler({
      swiss_backup_id: 4,
      slot_id: 3,
      action: "disable",
    })) as { status: "plan"; confirmation_token: string };

    await manageSwissBackupSlotTool.handler({
      swiss_backup_id: 4,
      slot_id: 3,
      action: "disable",
      confirmation_token: plan.confirmation_token,
    });

    expect(methods).toEqual(["GET", "GET", "POST"]);
    expect(urls[2]).toContain("/1/swiss_backups/4/slots/3/disable");
  });
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
