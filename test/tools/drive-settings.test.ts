import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getDriveSettingsTool,
  manageDriveSettingsTool,
} from "../../src/tools/drive-settings.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("kDrive settings tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("reads a kDrive settings snapshot without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return ok({
          ai: { enabled: true },
          link: { password_required: true },
          office: { default_editor: "online" },
          preferences: { dark_mode: false },
        });
      },
    ) as typeof fetch;

    const result = (await getDriveSettingsTool.handler({ drive_id: 55 })) as {
      drive_id: number;
      settings: Record<string, unknown>;
      summary_markdown: string;
    };

    expect(result.drive_id).toBe(55);
    expect(result.settings).toMatchObject({
      ai: { enabled: true },
      preferences: { dark_mode: false },
    });
    expect(result.summary_markdown).toContain("kDrive settings");
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.infomaniak.com/2/drive/55/settings",
      },
    ]);
  });

  it.each([
    {
      title: "updates AI settings",
      action: "update_ai" as const,
      settings: { enabled: false, model: "off" },
      expectedPath: "/2/drive/55/settings/ai",
    },
    {
      title: "updates link settings",
      action: "update_link" as const,
      settings: { password_required: true, default_expire_days: 7 },
      expectedPath: "/2/drive/55/settings/link",
    },
    {
      title: "updates office settings",
      action: "update_office" as const,
      settings: { editor: "online", comments: true },
      expectedPath: "/2/drive/55/settings/office",
    },
    {
      title: "updates preferences",
      action: "update_preferences" as const,
      settings: { dark_mode: true, compact_view: true },
      expectedPath: "/2/drive/55/preferences",
    },
  ])(
    "$title through the same two-phase confirmation flow",
    async (testCase) => {
      const requests: RecordedRequest[] = [];
      globalThis.fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input.toString();
          const request: RecordedRequest = {
            method: init?.method ?? "GET",
            url,
          };
          if (init?.body !== undefined) {
            request.body = JSON.parse(String(init.body));
          }
          requests.push(request);

          if (request.method === "GET") {
            return ok({
              ai: { enabled: true },
              link: { password_required: false },
              office: { default_editor: "desktop" },
              preferences: { dark_mode: false },
            });
          }
          return ok({ applied: true });
        },
      ) as typeof fetch;

      const plan = (await manageDriveSettingsTool.handler({
        drive_id: 55,
        action: testCase.action,
        settings: testCase.settings,
      })) as {
        status: "plan";
        confirmation_token: string;
        current_settings: Record<string, unknown>;
        settings: Record<string, unknown>;
      };

      expect(plan.status).toBe("plan");
      expect(plan.current_settings).toMatchObject({
        ai: { enabled: true },
        preferences: { dark_mode: false },
      });
      expect(plan.settings).toEqual(testCase.settings);
      expect(requests.map((request) => request.method)).toEqual(["GET"]);

      const applied = (await manageDriveSettingsTool.handler({
        drive_id: 55,
        action: testCase.action,
        settings: testCase.settings,
        confirmation_token: plan.confirmation_token,
      })) as {
        status: "applied";
        message: string;
      };

      expect(applied.status).toBe("applied");
      expect(applied.message).toContain("settings updated");
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        "PUT",
      ]);
      expect(requests[2]?.url).toBe(
        `https://api.infomaniak.com${testCase.expectedPath}`,
      );
      expect(requests[2]?.body).toEqual(testCase.settings);
    },
  );
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
