import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tools } from "../../src/tools/index.js";
import type { ToolDefinition } from "../../src/tools/types.js";
import { _resetConfirmationTokens } from "../../src/runtime/confirmation-store.js";

interface RecordedRequest {
  method: string;
  url: string;
  body?: unknown;
}

function toolNamed(name: string): ToolDefinition {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Tool ${name} is not registered`);
  }
  return tool;
}

function mockMailboxFetch(
  mailbox: Record<string, unknown>,
  requests: RecordedRequest[],
): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const request: RecordedRequest = { method, url };
      if (init?.body !== undefined) {
        request.body = JSON.parse(String(init.body));
      }
      requests.push(request);

      return new Response(
        JSON.stringify({ result: "success", data: mailbox }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    },
  ) as typeof fetch;
}

function mockMailboxAndFiltersFetch(
  mailbox: Record<string, unknown>,
  filters: Record<string, unknown>,
  requests: RecordedRequest[],
): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const request: RecordedRequest = { method, url };
      if (init?.body !== undefined) {
        request.body = JSON.parse(String(init.body));
      }
      requests.push(request);

      const data = url.includes("/auth/filters") ? filters : mailbox;
      return new Response(JSON.stringify({ result: "success", data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  ) as typeof fetch;
}

function mockFiltersFetch(
  filters: Record<string, unknown>,
  requests: RecordedRequest[],
): void {
  globalThis.fetch = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = init?.method ?? "GET";
      const request: RecordedRequest = { method, url };
      if (init?.body !== undefined) {
        request.body = JSON.parse(String(init.body));
      }
      requests.push(request);

      const data = method === "GET" ? filters : true;
      return new Response(JSON.stringify({ result: "success", data }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  ) as typeof fetch;
}

describe("mail security tools", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetConfirmationTokens();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    _resetConfirmationTokens();
  });

  it("gets mailbox security fields from the public mailbox endpoint", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxFetch(
      {
        mailbox_name: "info",
        authorized_senders: ["trusted@example.com"],
        blocked_senders: ["spam@example.com"],
        has_move_spam: true,
        has_mail_filtering: false,
        mail_filtering_folder_commercials: "Newsletters",
        mail_filtering_folder_social_networks: null,
        note: "security note",
      },
      requests,
    );

    const result = (await toolNamed("infomaniak_get_mailbox_security").handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
    })) as {
      mailbox_name: string;
      authorized_senders: string[];
      blocked_senders: string[];
      has_move_spam: boolean;
      has_mail_filtering: boolean;
      note: string | null;
    };

    expect(result).toMatchObject({
      mail_hosting_id: 123,
      mailbox_name: "info",
      authorized_senders: ["trusted@example.com"],
      blocked_senders: ["spam@example.com"],
      has_move_spam: true,
      has_mail_filtering: false,
      note: "security note",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toContain("/1/mail_hostings/123/mailboxes/info");
  });

  it("plans before blocking a sender and applies only after token confirmation", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxFetch(
      {
        mailbox_name: "info",
        authorized_senders: ["sales@example.com", "trusted@example.com"],
        blocked_senders: ["old-spam@example.com"],
      },
      requests,
    );

    const tool = toolNamed("infomaniak_block_sender");
    const plan = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      sender: "sales@example.com",
    })) as {
      status: "plan";
      confirmation_token: string;
      diff: {
        authorized_senders: { before: string[]; after: string[] };
        blocked_senders: { before: string[]; after: string[] };
      };
    };

    expect(plan.status).toBe("plan");
    expect(plan.diff.blocked_senders.after).toEqual([
      "old-spam@example.com",
      "sales@example.com",
    ]);
    expect(plan.diff.authorized_senders.after).toEqual(["trusted@example.com"]);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      sender: "sales@example.com",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; updated: Record<string, string[]> };

    expect(applied.status).toBe("applied");
    expect(applied.updated).toEqual({
      authorized_senders: ["trusted@example.com"],
      blocked_senders: ["old-spam@example.com", "sales@example.com"],
    });
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[2]?.body).toEqual({
      authorized_senders: ["trusted@example.com"],
      blocked_senders: ["old-spam@example.com", "sales@example.com"],
    });
  });

  it.each([
    {
      toolName: "infomaniak_unblock_sender",
      sender: "spam@example.com",
      mailbox: {
        mailbox_name: "info",
        authorized_senders: ["trusted@example.com"],
        blocked_senders: ["spam@example.com", "bulk@example.com"],
      },
      expectedPatch: {
        blocked_senders: ["bulk@example.com"],
      },
    },
    {
      toolName: "infomaniak_authorize_sender",
      sender: "spam@example.com",
      mailbox: {
        mailbox_name: "info",
        authorized_senders: ["trusted@example.com"],
        blocked_senders: ["spam@example.com", "bulk@example.com"],
      },
      expectedPatch: {
        authorized_senders: ["trusted@example.com", "spam@example.com"],
        blocked_senders: ["bulk@example.com"],
      },
    },
    {
      toolName: "infomaniak_unauthorize_sender",
      sender: "trusted@example.com",
      mailbox: {
        mailbox_name: "info",
        authorized_senders: ["trusted@example.com", "vip@example.com"],
        blocked_senders: ["spam@example.com"],
      },
      expectedPatch: {
        authorized_senders: ["vip@example.com"],
      },
    },
  ])("$toolName uses the same two-phase write contract", async (caseData) => {
    const requests: RecordedRequest[] = [];
    mockMailboxFetch(caseData.mailbox, requests);

    const tool = toolNamed(caseData.toolName);
    const plan = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      sender: caseData.sender,
    })) as {
      status: "plan";
      confirmation_token: string;
      updated: Record<string, string[]>;
    };

    expect(plan.status).toBe("plan");
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      sender: caseData.sender,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; updated: Record<string, string[]> };

    expect(applied.status).toBe("applied");
    expect(applied.updated).toEqual(caseData.expectedPatch);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[2]?.body).toEqual(caseData.expectedPatch);
  });

  it("lists mailbox sieve filter inventory without mutating state", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxAndFiltersFetch(
      { mailbox_name: "info" },
      {
        prevent_script: false,
        use_scripts: true,
        scripts: [
          { name: "custom-script", is_enabled: true, content: "keep;" },
        ],
        filters: [
          {
            name: "Move newsletters",
            is_enabled: true,
            has_all_of: false,
            conditions: [
              { property: "from", operator: "contains", value: "newsletter" },
            ],
            actions: [{ type: "move", value: "Newsletters" }],
            template_id: 42,
          },
        ],
        templates: [{ id: 42, name: "Newsletter template", is_visible: true }],
      },
      requests,
    );

    const result = (await toolNamed("infomaniak_list_mailbox_filters").handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
    })) as {
      mail_hosting_id: number;
      mailbox_name: string;
      filters: unknown[];
      scripts: unknown[];
      templates: unknown[];
      use_scripts: boolean;
    };

    expect(result).toMatchObject({
      mail_hosting_id: 123,
      mailbox_name: "info",
      use_scripts: true,
    });
    expect(result.filters).toHaveLength(1);
    expect(result.scripts).toHaveLength(1);
    expect(result.templates).toHaveLength(1);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    expect(requests[0]?.url).toContain(
      "/1/mail_hostings/123/mailboxes/info/auth/filters",
    );
  });

  it("lists mailbox sieve scripts as a focused read-only view", async () => {
    const requests: RecordedRequest[] = [];
    mockFiltersFetch(
      {
        prevent_script: false,
        use_scripts: true,
        scripts: [
          { name: "admin-sieve", is_enabled: true, content: "keep;" },
          { name: "disabled-sieve", is_enabled: false, content: "discard;" },
        ],
        filters: [{ name: "Move newsletters", is_enabled: true }],
        templates: [],
      },
      requests,
    );

    const result = (await toolNamed(
      "infomaniak_list_mailbox_filter_scripts",
    ).handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
    })) as {
      mail_hosting_id: number;
      mailbox_name: string;
      prevent_script?: boolean;
      use_scripts?: boolean;
      scripts: unknown[];
      script?: string;
    };

    expect(result).toMatchObject({
      mail_hosting_id: 123,
      mailbox_name: "info",
      prevent_script: false,
      use_scripts: true,
    });
    expect(result.scripts).toHaveLength(2);
    expect(requests.map((request) => request.method)).toEqual(["GET"]);
    expect(requests[0]?.url).toContain(
      "/1/mail_hostings/123/mailboxes/info/auth/filters",
    );
  });

  it("plans and applies mailbox spam policy changes with two-phase confirmation", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxFetch(
      {
        mailbox_name: "info",
        authorized_senders: [],
        blocked_senders: [],
        has_move_spam: false,
        has_mail_filtering: false,
        mail_filtering_folder_commercials: null,
        mail_filtering_folder_social_networks: null,
        note: "old note",
      },
      requests,
    );

    const tool = toolNamed("infomaniak_set_mailbox_spam_policy");
    const plan = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      has_move_spam: true,
      has_mail_filtering: true,
      mail_filtering_folder_commercials: "Newsletters",
      note: "reviewed",
    })) as {
      status: "plan";
      confirmation_token: string;
      updated: Record<string, unknown>;
      diff: Record<string, { before: unknown; after: unknown }>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.updated).toEqual({
      has_move_spam: true,
      has_mail_filtering: true,
      mail_filtering_folder_commercials: "Newsletters",
      note: "reviewed",
    });
    expect(plan.diff["has_move_spam"]).toEqual({ before: false, after: true });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      has_move_spam: true,
      has_mail_filtering: true,
      mail_filtering_folder_commercials: "Newsletters",
      note: "reviewed",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; updated: Record<string, unknown> };

    expect(applied.status).toBe("applied");
    expect(applied.updated).toEqual(plan.updated);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[2]?.body).toEqual(plan.updated);
  });

  it("plans and applies mailbox folder mapping updates through the folders API", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxFetch(
      {
        mailbox_name: "info",
        authorized_senders: [],
        blocked_senders: [],
        has_move_spam: true,
        has_mail_filtering: true,
        mail_filtering_folder_commercials: "Old newsletters",
        mail_filtering_folder_social_networks: "Old social",
      },
      requests,
    );

    const input = {
      mail_hosting_id: 123,
      mailbox_name: "info",
      archives_folder: "Archives",
      draft_folder: "Drafts",
      sent_folder: "Sent",
      trash_folder: "Trash",
      spam_folder: "Spam",
      commercials_folder: "Newsletters",
      social_networks_folder: "Social",
    };
    const tool = toolNamed("infomaniak_update_mailbox_folders");
    const plan = (await tool.handler(input)) as {
      status: "plan";
      confirmation_token: string;
      folder_mapping: Record<string, string>;
    };

    expect(plan.status).toBe("plan");
    expect(plan.folder_mapping).toMatchObject({
      archives_folder: "Archives",
      spam_folder: "Spam",
      commercials_folder: "Newsletters",
      social_networks_folder: "Social",
    });
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await tool.handler({
      ...input,
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; folder_mapping: Record<string, string> };

    expect(applied.status).toBe("applied");
    expect(applied.folder_mapping).toEqual(plan.folder_mapping);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "PUT",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/123/mailboxes/info/auth/folders",
    );
    expect(requests[2]?.body).toEqual(plan.folder_mapping);
  });

  it("plans and applies spam folder purge through two-phase confirmation", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxFetch(
      {
        mailbox_name: "info",
        authorized_senders: [],
        blocked_senders: [],
        has_move_spam: true,
      },
      requests,
    );

    const tool = toolNamed("infomaniak_purge_spam_folder");
    const plan = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
    })) as { status: "plan"; confirmation_token: string };

    expect(plan.status).toBe("plan");
    expect(requests.map((request) => request.method)).toEqual(["GET"]);

    const applied = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; message: string };

    expect(applied.status).toBe("applied");
    expect(applied.message).toContain("Spam folder purged");
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "DELETE",
    ]);
    expect(requests[2]?.url).toContain(
      "/1/mail_hostings/123/mailboxes/info/auth/folders/spam",
    );
    expect(requests[2]?.body).toBeUndefined();
  });

  it.each([
    {
      toolName: "infomaniak_create_mailbox_filter",
      input: {
        name: "Quarantine invoices",
        has_all_of: true,
        is_enabled: true,
        template_id: 42,
      },
      filters: { filters: [], scripts: [], templates: [] },
      expectedMethod: "POST",
      expectedPath: "/auth/filters",
      expectedBody: {
        name: "Quarantine invoices",
        has_all_of: true,
        is_enabled: true,
        template_id: 42,
      },
    },
    {
      toolName: "infomaniak_update_mailbox_filter",
      input: {
        old_name: "Old invoices",
        name: "Quarantine invoices",
        has_all_of: false,
        is_enabled: true,
        template_id: null,
      },
      filters: {
        filters: [
          { name: "Old invoices", has_all_of: true, is_enabled: false },
        ],
        scripts: [],
        templates: [],
      },
      expectedMethod: "PATCH",
      expectedPath: "/auth/filters",
      expectedBody: {
        old_name: "Old invoices",
        name: "Quarantine invoices",
        has_all_of: false,
        is_enabled: true,
        template_id: null,
      },
    },
    {
      toolName: "infomaniak_delete_mailbox_filter",
      input: { name: "Old invoices" },
      filters: {
        filters: [
          { name: "Old invoices", has_all_of: true, is_enabled: false },
        ],
        scripts: [],
        templates: [],
      },
      expectedMethod: "DELETE",
      expectedPath: "/auth/filters?name=Old+invoices",
      expectedBody: undefined,
    },
    {
      toolName: "infomaniak_upsert_mailbox_filter_script",
      input: {
        name: "admin-sieve",
        content: 'if header :contains "subject" "invoice" { keep; }',
        is_enabled: true,
      },
      filters: { filters: [], scripts: [], templates: [] },
      expectedMethod: "POST",
      expectedPath: "/auth/filters/scripts",
      expectedBody: {
        name: "admin-sieve",
        content: 'if header :contains "subject" "invoice" { keep; }',
        is_enabled: true,
      },
    },
    {
      toolName: "infomaniak_delete_mailbox_filter_script",
      input: { name: "admin-sieve" },
      filters: {
        filters: [],
        scripts: [{ name: "admin-sieve", content: "keep;", is_enabled: true }],
        templates: [],
      },
      expectedMethod: "DELETE",
      expectedPath: "/auth/filters/scripts?name=admin-sieve",
      expectedBody: undefined,
    },
  ])(
    "$toolName plans and applies through the filters API",
    async (caseData) => {
      const requests: RecordedRequest[] = [];
      mockFiltersFetch(caseData.filters, requests);

      const tool = toolNamed(caseData.toolName);
      const plan = (await tool.handler({
        mail_hosting_id: 123,
        mailbox_name: "info",
        ...caseData.input,
      })) as {
        status: "plan";
        confirmation_token: string;
        mutation: Record<string, unknown>;
      };

      expect(plan.status).toBe("plan");
      expect(plan.mutation).toMatchObject({
        method: caseData.expectedMethod,
        endpoint_kind: caseData.expectedPath.includes("scripts")
          ? "script"
          : "filter",
      });
      expect(requests.map((request) => request.method)).toEqual(["GET"]);

      const applied = (await tool.handler({
        mail_hosting_id: 123,
        mailbox_name: "info",
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
      expect(requests[2]?.body).toEqual(caseData.expectedBody);
    },
  );

  it("audits mailbox security posture from mailbox policy and Sieve inventory", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxAndFiltersFetch(
      {
        mailbox_name: "info",
        authorized_senders: ["vip@example.com"],
        blocked_senders: ["vip@example.com"],
        has_move_spam: false,
        has_mail_filtering: false,
        mail_filtering_folder_commercials: null,
        mail_filtering_folder_social_networks: null,
      },
      {
        use_scripts: true,
        scripts: [
          { name: "custom-admin-script", is_enabled: true, content: "keep;" },
        ],
        filters: [{ name: "Legacy disabled filter", is_enabled: false }],
        templates: [],
      },
      requests,
    );

    const result = (await toolNamed(
      "infomaniak_audit_mailbox_security",
    ).handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
    })) as {
      status: "review_needed" | "healthy";
      findings: Array<{ category: string; severity: string }>;
      summary: { critical: number; warning: number; info: number };
    };

    expect(result.status).toBe("review_needed");
    expect(result.summary.warning).toBeGreaterThanOrEqual(3);
    expect(result.findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining([
        "spam_policy",
        "mail_filtering",
        "sender_conflict",
        "custom_sieve_script",
        "disabled_filter",
      ]),
    );
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);
  });

  it("plans and applies mailbox security hardening through two-phase confirmation", async () => {
    const requests: RecordedRequest[] = [];
    mockMailboxAndFiltersFetch(
      {
        mailbox_name: "info",
        authorized_senders: [],
        blocked_senders: [],
        has_move_spam: false,
        has_mail_filtering: false,
        mail_filtering_folder_commercials: null,
        mail_filtering_folder_social_networks: null,
      },
      { scripts: [], filters: [], templates: [] },
      requests,
    );

    const tool = toolNamed("infomaniak_harden_mailbox_security");
    const plan = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      mail_filtering_folder_commercials: "Newsletters",
      mail_filtering_folder_social_networks: "Social",
    })) as {
      status: "plan";
      confirmation_token: string;
      updated: Record<string, unknown>;
      audit: { status: string };
    };

    expect(plan.status).toBe("plan");
    expect(plan.audit.status).toBe("review_needed");
    expect(plan.updated).toEqual({
      has_move_spam: true,
      has_mail_filtering: true,
      mail_filtering_folder_commercials: "Newsletters",
      mail_filtering_folder_social_networks: "Social",
    });
    expect(requests.map((request) => request.method)).toEqual(["GET", "GET"]);

    const applied = (await tool.handler({
      mail_hosting_id: 123,
      mailbox_name: "info",
      mail_filtering_folder_commercials: "Newsletters",
      mail_filtering_folder_social_networks: "Social",
      confirmation_token: plan.confirmation_token,
    })) as { status: "applied"; updated: Record<string, unknown> };

    expect(applied.status).toBe("applied");
    expect(applied.updated).toEqual(plan.updated);
    expect(requests.map((request) => request.method)).toEqual([
      "GET",
      "GET",
      "GET",
      "GET",
      "PATCH",
    ]);
    expect(requests[4]?.body).toEqual(plan.updated);
  });
});
