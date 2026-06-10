import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getAccountInvitationAccessTool,
  manageAccountInvitationAccessTool,
} from "../../src/tools/account-invitation-access.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

describe("account invitation access tools", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("reads a single invitation snapshot without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    globalThis.fetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        requests.push({ method: init?.method ?? "GET", url });
        return ok({
          id: 77,
          status: "pending",
          email: "contractor@example.com",
          access: { ksuite: true, drive: false, mailbox: false, kchat: false },
        });
      },
    ) as typeof fetch;

    const result = (await getAccountInvitationAccessTool.handler({
      account_id: 123,
      invitation_id: 77,
    })) as {
      account_id: number;
      invitation_id: number;
      invitation: Record<string, unknown>;
      summary_markdown: string;
    };

    expect(result).toMatchObject({
      account_id: 123,
      invitation_id: 77,
      invitation: expect.objectContaining({
        id: 77,
        status: "pending",
      }),
    });
    expect(result.summary_markdown).toContain("Account invitation access");
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://api.infomaniak.com/1/accounts/123/invitations/77",
      },
    ]);
  });

  it.each([
    {
      title: "revokes kSuite access",
      input: {
        account_id: 123,
        invitation_id: 77,
        target: "ksuite" as const,
        action: "delete" as const,
      },
      expectedPath: "/1/accounts/123/invitations/77/ksuite",
      expectedMethod: "DELETE",
      expectedBody: undefined,
    },
    {
      title: "grants drive access",
      input: {
        account_id: 123,
        invitation_id: 77,
        target: "drive" as const,
        action: "create" as const,
        drive_id: 44,
        payload: { role: "manager" },
      },
      expectedPath: "/1/accounts/123/invitations/77/drive",
      expectedMethod: "POST",
      expectedBody: { drive_id: 44, role: "manager" },
    },
    {
      title: "creates mailbox access",
      input: {
        account_id: 123,
        invitation_id: 77,
        target: "mailbox" as const,
        action: "create" as const,
        mail_id: 99,
        payload: { role: "owner" },
      },
      expectedPath: "/1/accounts/123/invitations/77/mailbox/99",
      expectedMethod: "POST",
      expectedBody: { mail_id: 99, role: "owner" },
    },
    {
      title: "invites mailbox access",
      input: {
        account_id: 123,
        invitation_id: 77,
        target: "mailbox" as const,
        action: "invite" as const,
        payload: { email: "new@example.com" },
      },
      expectedPath: "/1/accounts/123/invitations/77/mailbox/invite",
      expectedMethod: "POST",
      expectedBody: { email: "new@example.com" },
    },
    {
      title: "updates kChat access",
      input: {
        account_id: 123,
        invitation_id: 77,
        target: "kchat" as const,
        action: "update" as const,
        payload: { can_post: true },
      },
      expectedPath: "/1/accounts/123/invitations/77/kchat",
      expectedMethod: "PATCH",
      expectedBody: { can_post: true },
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
              id: 77,
              status: "pending",
              email: "contractor@example.com",
              access: {
                ksuite: false,
                drive: false,
                mailbox: false,
                kchat: false,
              },
            });
          }
          return ok({ applied: true });
        },
      ) as typeof fetch;

      const plan = (await manageAccountInvitationAccessTool.handler(
        testCase.input,
      )) as {
        status: "plan";
        confirmation_token: string;
        current_invitation: Record<string, unknown>;
      };

      expect(plan.status).toBe("plan");
      expect(plan.current_invitation).toMatchObject({
        id: 77,
        status: "pending",
      });
      expect(requests.map((request) => request.method)).toEqual(["GET"]);

      const applied = (await manageAccountInvitationAccessTool.handler({
        ...testCase.input,
        confirmation_token: plan.confirmation_token,
      })) as {
        status: "applied";
        message: string;
      };

      expect(applied.status).toBe("applied");
      expect(applied.message).toContain("invitation access");
      expect(requests.map((request) => request.method)).toEqual([
        "GET",
        "GET",
        testCase.expectedMethod,
      ]);
      expect(requests[2]?.url).toBe(
        `https://api.infomaniak.com${testCase.expectedPath}`,
      );
      expect(requests[2]?.body).toEqual(testCase.expectedBody);
    },
  );
});

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
