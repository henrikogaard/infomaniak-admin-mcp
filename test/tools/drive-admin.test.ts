import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditKdriveAdminTool,
  createDriveShareLinkTool,
  createDriveFileAccessInvitationTool,
  createDriveFileAccessTeamTool,
  createDriveFileAccessUserTool,
  createDriveUserTool,
  deleteDriveUserTool,
  emptyDriveTrashTool,
  getDriveShareLinkTool,
  getDriveStatisticsTool,
  listDriveFileAccessInvitationsTool,
  listDriveFileAccessTeamsTool,
  listDriveFileAccessUsersTool,
  inviteDriveShareLinkTool,
  listDriveShareLinksTool,
  lockDriveUserTool,
  removeDriveFileAccessTeamTool,
  removeDriveFileAccessUserTool,
  removeDriveTrashItemTool,
  removeDriveShareLinkTool,
  restoreDriveTrashItemTool,
  setDriveUserManagerTool,
  unlockDriveUserTool,
  updateDriveTrashSettingsTool,
  updateDriveShareLinkTool,
  updateDriveFileAccessTeamTool,
  updateDriveFileAccessUserTool,
  updateDriveUserTool,
} from "../../src/tools/drive-admin.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("kDrive admin tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("audits kDrive users, share links, settings, and trash count without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });

        if (url.includes("/2/drive/55/settings")) {
          return json({ public_share_links: true, trash_retention_days: 7 });
        }
        if (url.includes("/3/drive/55/files/links")) {
          return json([
            { id: 501, name: "Board pack", password: false, expire_at: null },
            {
              id: 502,
              name: "Secured pack",
              password: true,
              expire_at: 1_800_000_000,
            },
          ]);
        }
        if (url.includes("/2/drive/55/trash/count")) {
          return json({ count: 12 });
        }
        if (url.includes("/2/drive/55/users")) {
          return json([
            { id: 1, email: "admin@example.com", role: "admin", manager: true },
            { id: 2, email: "contractor@external.test", role: "external" },
          ]);
        }
        if (url.includes("/2/drive/55")) {
          return json({
            id: 55,
            name: "Company Drive",
            size: 1000,
            used_size: 930,
            users_count: 2,
            users_quota: 5,
            in_maintenance: false,
          });
        }
        return json({});
      },
    ) as typeof fetch;

    const result = (await auditKdriveAdminTool.handler({ drive_id: 55 })) as {
      drive_id: number;
      summary: { users: number; share_links: number; trash_items: number };
      findings: Array<{ category: string; severity: string }>;
    };

    expect(result.drive_id).toBe(55);
    expect(result.summary).toMatchObject({
      users: 2,
      share_links: 2,
      trash_items: 12,
    });
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          category: "storage_usage",
          severity: "warning",
        }),
        expect.objectContaining({
          category: "public_share_links",
          severity: "warning",
        }),
        expect.objectContaining({
          category: "external_users",
          severity: "info",
        }),
      ]),
    );
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });

  it("plans and applies empty trash through two-phase confirmation", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await emptyDriveTrashTool.handler({ drive_id: 55 })) as {
      status: "plan";
      confirmation_token: string;
      current_trash_count: number;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_trash_count).toBe(3);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await emptyDriveTrashTool.handler({
      drive_id: 55,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(applied.message).toContain("trash emptied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/trash");
  });

  it("plans and applies restoring a trashed item", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await restoreDriveTrashItemTool.handler({
      drive_id: 55,
      file_id: 777,
    })) as {
      status: "plan";
      confirmation_token: string;
      item: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.item).toMatchObject({ id: 777, name: "Deleted budget.xlsx" });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await restoreDriveTrashItemTool.handler({
      drive_id: 55,
      file_id: 777,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(applied.message).toContain("restored");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/trash/777/restore");
  });

  it("plans and applies permanently removing a trashed item", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await removeDriveTrashItemTool.handler({
      drive_id: 55,
      file_id: 777,
    })) as {
      status: "plan";
      confirmation_token: string;
      item: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.item).toMatchObject({ id: 777, name: "Deleted budget.xlsx" });

    const applied = (await removeDriveTrashItemTool.handler({
      drive_id: 55,
      file_id: 777,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(applied.message).toContain("permanently removed");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/trash/777");
  });

  it("plans and applies trash settings updates with current settings guard", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await updateDriveTrashSettingsTool.handler({
      drive_id: 55,
      settings: { retention_days: 30, auto_delete: true },
    })) as {
      status: "plan";
      confirmation_token: string;
      current_settings: Record<string, unknown>;
      settings: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_settings).toMatchObject({ trash_retention_days: 7 });
    expect(plan.settings).toEqual({ retention_days: 30, auto_delete: true });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await updateDriveTrashSettingsTool.handler({
      drive_id: 55,
      settings: { retention_days: 30, auto_delete: true },
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; settings: Record<string, unknown> };

    expect(applied.status).toBe("applied");
    expect(applied.settings).toEqual(plan.settings);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/settings/trash");
    expect(requests[2]?.body).toEqual(plan.settings);
  });

  it("lists and gets kDrive share links without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const list = (await listDriveShareLinksTool.handler({ drive_id: 55 })) as {
      drive_id: number;
      links: unknown[];
    };
    const get = (await getDriveShareLinkTool.handler({
      drive_id: 55,
      file_id: 888,
    })) as {
      drive_id: number;
      file_id: number;
      link: Record<string, unknown> | null;
    };

    expect(list.links).toHaveLength(1);
    expect(get.link).toMatchObject({ uuid: "share-888", file_id: 888 });
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
    expect(requests[0]?.url).toContain("/3/drive/55/files/links");
    expect(requests[1]?.url).toContain("/2/drive/55/files/888/link");
  });

  it.each([
    {
      statistic: "sizes",
      export: false,
      expectedPath: "/2/drive/55/statistics/sizes",
    },
    {
      statistic: "sizes",
      export: true,
      expectedPath: "/2/drive/55/statistics/sizes/export",
    },
    {
      statistic: "activities_users",
      export: false,
      expectedPath: "/2/drive/55/statistics/activities/users",
    },
    {
      statistic: "shared_files",
      export: false,
      expectedPath: "/2/drive/55/statistics/activities/shared_files",
    },
    {
      statistic: "activities",
      export: true,
      expectedPath: "/2/drive/55/statistics/activities/export",
    },
    {
      statistic: "share_links",
      export: true,
      expectedPath: "/2/drive/55/statistics/activities/links/export",
    },
  ])("reads kDrive $statistic statistics", async (caseData) => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const result = (await getDriveStatisticsTool.handler({
      drive_id: 55,
      statistic: caseData.statistic,
      export: caseData.export,
      query: { from: "2026-01-01" },
    })) as {
      endpoint: string;
      data: Record<string, unknown>;
    };

    expect(result.endpoint).toBe(caseData.expectedPath);
    expect(result.data).toMatchObject({ rows: [] });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    expect(requests[0]?.url).toContain(caseData.expectedPath);
    expect(requests[0]?.url).toContain("from=2026-01-01");
  });

  it("lists kDrive file access collections without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const users = (await listDriveFileAccessUsersTool.handler({
      drive_id: 55,
      file_id: 888,
    })) as { items: unknown[] };
    const teams = (await listDriveFileAccessTeamsTool.handler({
      drive_id: 55,
      file_id: 888,
    })) as { items: unknown[] };
    const invitations = (await listDriveFileAccessInvitationsTool.handler({
      drive_id: 55,
      file_id: 888,
    })) as { items: unknown[] };

    expect(users.items).toHaveLength(1);
    expect(teams.items).toHaveLength(1);
    expect(invitations.items).toHaveLength(1);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
    ]);
    expect(requests[0]?.url).toContain("/2/drive/55/files/888/access/users");
    expect(requests[1]?.url).toContain("/2/drive/55/files/888/access/teams");
    expect(requests[2]?.url).toContain(
      "/2/drive/55/files/888/access/invitations",
    );
  });

  it.each([
    {
      tool: createDriveFileAccessUserTool,
      action: "create",
      expectedMethod: "POST",
      expectedPath: "/2/drive/55/files/888/access/users",
      input: {
        drive_id: 55,
        file_id: 888,
        user_id: 2,
        payload: { role: "write" },
      },
      expectedBody: { user_id: 2, role: "write" },
    },
    {
      tool: updateDriveFileAccessUserTool,
      action: "update",
      expectedMethod: "PUT",
      expectedPath: "/2/drive/55/files/888/access/users/2",
      input: {
        drive_id: 55,
        file_id: 888,
        user_id: 2,
        payload: { role: "read" },
      },
      expectedBody: { role: "read" },
    },
    {
      tool: removeDriveFileAccessUserTool,
      action: "remove",
      expectedMethod: "DELETE",
      expectedPath: "/2/drive/55/files/888/access/users/2",
      input: { drive_id: 55, file_id: 888, user_id: 2 },
      expectedBody: undefined,
    },
  ])(
    "plans and applies $action for a kDrive file user access",
    async (caseData) => {
      const requests: RecordedRequest[] = [];
      mockKdriveAdminFetch(requests);

      const plan = (await caseData.tool.handler(caseData.input)) as {
        status: "plan";
        confirmation_token: string;
        current_access: unknown[];
        current_entry: Record<string, unknown> | null;
        payload?: Record<string, unknown>;
      };

      expect(plan.status).toBe("plan");
      expect(plan.current_access).toHaveLength(1);
      expect(plan.current_entry).toMatchObject({ user_id: 2, role: "write" });
      if (caseData.expectedBody !== undefined) {
        expect(plan.payload).toEqual(caseData.input.payload);
      }

      const applied = (await caseData.tool.handler({
        ...caseData.input,
        confirmation_token: plan.confirmation_token,
      })) as { status: "applied" };

      expect(applied.status).toBe("applied");
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        caseData.expectedMethod,
      ]);
      expect(requests[2]?.url).toContain(caseData.expectedPath);
      if (caseData.expectedBody !== undefined) {
        expect(requests[2]?.body).toEqual(caseData.expectedBody);
      }
    },
  );

  it.each([
    {
      tool: createDriveFileAccessTeamTool,
      action: "create",
      expectedMethod: "POST",
      expectedPath: "/2/drive/55/files/888/access/teams",
      input: {
        drive_id: 55,
        file_id: 888,
        team_id: 33,
        payload: { role: "write" },
      },
      expectedBody: { team_id: 33, role: "write" },
    },
    {
      tool: updateDriveFileAccessTeamTool,
      action: "update",
      expectedMethod: "PUT",
      expectedPath: "/2/drive/55/files/888/access/teams/33",
      input: {
        drive_id: 55,
        file_id: 888,
        team_id: 33,
        payload: { role: "admin" },
      },
      expectedBody: { role: "admin" },
    },
    {
      tool: removeDriveFileAccessTeamTool,
      action: "remove",
      expectedMethod: "DELETE",
      expectedPath: "/2/drive/55/files/888/access/teams/33",
      input: { drive_id: 55, file_id: 888, team_id: 33 },
      expectedBody: undefined,
    },
  ])(
    "plans and applies $action for a kDrive file team access",
    async (caseData) => {
      const requests: RecordedRequest[] = [];
      mockKdriveAdminFetch(requests);

      const plan = (await caseData.tool.handler(caseData.input)) as {
        status: "plan";
        confirmation_token: string;
        current_access: unknown[];
        current_entry: Record<string, unknown> | null;
        payload?: Record<string, unknown>;
      };

      expect(plan.status).toBe("plan");
      expect(plan.current_access).toHaveLength(1);
      expect(plan.current_entry).toMatchObject({ team_id: 33, role: "read" });
      if (caseData.expectedBody !== undefined) {
        expect(plan.payload).toEqual(caseData.input.payload);
      }

      const applied = (await caseData.tool.handler({
        ...caseData.input,
        confirmation_token: plan.confirmation_token,
      })) as { status: "applied" };

      expect(applied.status).toBe("applied");
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        caseData.expectedMethod,
      ]);
      expect(requests[2]?.url).toContain(caseData.expectedPath);
      if (caseData.expectedBody !== undefined) {
        expect(requests[2]?.body).toEqual(caseData.expectedBody);
      }
    },
  );

  it("plans and applies inviting kDrive file access", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const input = {
      drive_id: 55,
      file_id: 888,
      payload: { email: "external@example.com", role: "read" },
    };
    const plan = (await createDriveFileAccessInvitationTool.handler(input)) as {
      status: "plan";
      confirmation_token: string;
      current_access: unknown[];
      current_entry: Record<string, unknown> | null;
      payload: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_access).toHaveLength(1);
    expect(plan.payload).toEqual(input.payload);

    const applied = (await createDriveFileAccessInvitationTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.url).toContain(
      "/2/drive/55/files/888/access/invitations",
    );
    expect(requests[2]?.body).toEqual(input.payload);
  });

  it.each([
    {
      tool: createDriveShareLinkTool,
      action: "create",
      expectedMethod: "POST",
    },
    {
      tool: updateDriveShareLinkTool,
      action: "update",
      expectedMethod: "PUT",
    },
  ])("plans and applies $action for a kDrive share link", async (caseData) => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const input = {
      drive_id: 55,
      file_id: 888,
      link: { password: true, expire_at: 1_800_000_000 },
    };
    const plan = (await caseData.tool.handler(input)) as {
      status: "plan";
      confirmation_token: string;
      current_link: Record<string, unknown> | null;
      link: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_link).toMatchObject({ uuid: "share-888" });
    expect(plan.link).toEqual(input.link);

    const applied = (await caseData.tool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      caseData.expectedMethod,
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/files/888/link");
    expect(requests[2]?.body).toEqual(input.link);
  });

  it("plans and applies removing a kDrive share link", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await removeDriveShareLinkTool.handler({
      drive_id: 55,
      file_id: 888,
    })) as {
      status: "plan";
      confirmation_token: string;
      current_link: Record<string, unknown> | null;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_link).toMatchObject({ uuid: "share-888" });

    const applied = (await removeDriveShareLinkTool.handler({
      drive_id: 55,
      file_id: 888,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/files/888/link");
  });

  it("plans and applies inviting recipients to a kDrive share link", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const input = {
      drive_id: 55,
      file_id: 888,
      invitation: {
        emails: ["external@example.com"],
        message: "Please review",
      },
    };
    const plan = (await inviteDriveShareLinkTool.handler(input)) as {
      status: "plan";
      confirmation_token: string;
      current_link: Record<string, unknown> | null;
      invitation: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_link).toMatchObject({ uuid: "share-888" });
    expect(plan.invitation).toEqual(input.invitation);

    const applied = (await inviteDriveShareLinkTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/files/888/link/invite");
    expect(requests[2]?.body).toEqual(input.invitation);
  });

  it("plans and applies creating a drive user with current user-list guard", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const input = {
      drive_id: 55,
      user: { email: "new@example.com", role: "user" },
    };
    const plan = (await createDriveUserTool.handler(input)) as {
      status: "plan";
      confirmation_token: string;
      current_users: unknown[];
      user: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_users).toHaveLength(1);
    expect(plan.user).toEqual(input.user);

    const applied = (await createDriveUserTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; user: Record<string, unknown> };

    expect(applied.status).toBe("applied");
    expect(applied.user).toEqual(input.user);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "POST",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/users");
    expect(requests[2]?.body).toEqual(input.user);
  });

  it("plans and applies updating a drive user with current user guard", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const input = { drive_id: 55, user_id: 2, user: { role: "admin" } };
    const plan = (await updateDriveUserTool.handler(input)) as {
      status: "plan";
      confirmation_token: string;
      current_user: Record<string, unknown>;
      user: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_user).toMatchObject({
      id: 2,
      email: "user@example.com",
    });

    const applied = (await updateDriveUserTool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/users/2");
    expect(requests[2]?.body).toEqual(input.user);
  });

  it.each([
    {
      tool: deleteDriveUserTool,
      action: "delete",
      expectedMethod: "DELETE",
      expectedPath: "/2/drive/55/users/2",
    },
    {
      tool: lockDriveUserTool,
      action: "lock",
      expectedMethod: "POST",
      expectedPath: "/2/drive/55/users/2/lock",
    },
    {
      tool: unlockDriveUserTool,
      action: "unlock",
      expectedMethod: "POST",
      expectedPath: "/2/drive/55/users/2/unlock",
    },
  ])("plans and applies $action for a drive user", async (caseData) => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await caseData.tool.handler({
      drive_id: 55,
      user_id: 2,
    })) as {
      status: "plan";
      confirmation_token: string;
      current_user: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_user).toMatchObject({
      id: 2,
      email: "user@example.com",
    });

    const applied = (await caseData.tool.handler({
      drive_id: 55,
      user_id: 2,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      caseData.expectedMethod,
    ]);
    expect(requests[2]?.url).toContain(caseData.expectedPath);
  });

  it("plans and applies drive user manager-right updates", async () => {
    const requests: RecordedRequest[] = [];
    mockKdriveAdminFetch(requests);

    const plan = (await setDriveUserManagerTool.handler({
      drive_id: 55,
      user_id: 2,
      is_manager: true,
    })) as {
      status: "plan";
      confirmation_token: string;
      current_user: Record<string, unknown>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.current_user).toMatchObject({ id: 2, manager: false });

    const applied = (await setDriveUserManagerTool.handler({
      drive_id: 55,
      user_id: 2,
      is_manager: true,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied" };

    expect(applied.status).toBe("applied");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[2]?.url).toContain("/2/drive/55/users/2/manager");
    expect(requests[2]?.body).toEqual({ is_manager: true });
  });
});

function mockKdriveAdminFetch(requests: RecordedRequest[]): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const request: RecordedRequest = { method: init?.method ?? "GET", url };
      if (init?.body !== undefined) {
        request.body = JSON.parse(String(init.body));
      }
      requests.push(request);

      if (url.includes("/2/drive/55/settings")) {
        return json({ public_share_links: true, trash_retention_days: 7 });
      }
      if (url.includes("/3/drive/55/files/links")) {
        return json([
          {
            uuid: "share-888",
            file_id: 888,
            name: "Board pack",
            password: false,
          },
        ]);
      }
      if (url.includes("/2/drive/55/files/888/link")) {
        return json({
          uuid: "share-888",
          file_id: 888,
          password: false,
          expire_at: null,
        });
      }
      if (url.includes("/2/drive/55/files/888/access/users")) {
        if (url.includes("/2/drive/55/files/888/access/users/2")) {
          return json({ user_id: 2, role: "write" });
        }
        return json([{ user_id: 2, role: "write" }]);
      }
      if (url.includes("/2/drive/55/files/888/access/teams")) {
        if (url.includes("/2/drive/55/files/888/access/teams/33")) {
          return json({ team_id: 33, role: "read" });
        }
        return json([{ team_id: 33, role: "read" }]);
      }
      if (url.includes("/2/drive/55/files/888/access/invitations")) {
        return json([
          { invitation_id: 44, email: "invitee@example.com", role: "read" },
        ]);
      }
      if (url.includes("/2/drive/55/statistics/")) {
        return json({ rows: [] });
      }
      if (url.endsWith("/2/drive/55/users")) {
        return json([
          { id: 2, email: "user@example.com", role: "user", manager: false },
        ]);
      }
      if (url.includes("/2/drive/55/users/2")) {
        return json({
          id: 2,
          email: "user@example.com",
          role: "user",
          manager: false,
        });
      }
      if (url.includes("/2/drive/55/trash/count")) {
        return json({ count: 3 });
      }
      if (url.includes("/3/drive/55/trash/777")) {
        return json({
          id: 777,
          name: "Deleted budget.xlsx",
          type: "file",
          drive_id: 55,
          deleted_at: 1_700_000_000,
        });
      }
      return json(true);
    },
  ) as typeof fetch;
}

function json(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
