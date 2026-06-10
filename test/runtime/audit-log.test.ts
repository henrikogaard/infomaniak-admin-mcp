import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import {
  auditToolExecution,
  readAuditLog,
} from "../../src/runtime/audit-log.js";

const ORIGINAL_ENV = { ...process.env };

describe("persistent audit log", () => {
  let directory: string;
  let auditPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "infomaniak-audit-"));
    auditPath = join(directory, "audit.jsonl");
    process.env = { ...ORIGINAL_ENV };
    process.env["INFOMANIAK_API_TOKEN"] = "test-token-placeholder-".padEnd(
      40,
      "x",
    );
    process.env["INFOMANIAK_AUDIT_LOG_ENABLED"] = "true";
    process.env["INFOMANIAK_AUDIT_LOG_INCLUDE_READS"] = "true";
    process.env["INFOMANIAK_AUDIT_LOG_PATH"] = auditPath;
    _resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    _resetConfigCache();
    rmSync(directory, { recursive: true, force: true });
  });

  it("writes plan, apply_attempt, applied, and failed events with redacted secrets", async () => {
    await auditToolExecution(
      {
        name: "infomaniak_block_sender",
        description: "Block a sender. Two-phase confirmation.",
        annotations: { readOnlyHint: false },
        capability: {
          scope: "admin",
          risk: "write",
          confirmationRequired: true,
        },
      },
      {
        mailbox_name: "info@example.com",
        sender: "spam@example.net",
        password: "secret-password",
      },
      async () => ({
        status: "plan",
        confirmation_token: "00000000-0000-0000-0000-000000000000",
        diff: { blocked_senders: { before: [], after: ["spam@example.net"] } },
      }),
    );

    await auditToolExecution(
      {
        name: "infomaniak_block_sender",
        description: "Block a sender. Two-phase confirmation.",
        annotations: { readOnlyHint: false },
        capability: {
          scope: "admin",
          risk: "write",
          confirmationRequired: true,
        },
      },
      {
        mailbox_name: "info@example.com",
        sender: "spam@example.net",
        confirmation_token: "00000000-0000-0000-0000-000000000000",
      },
      async () => ({
        status: "applied",
        updated: { blocked_senders: ["spam@example.net"] },
      }),
    );

    await expect(
      auditToolExecution(
        {
          name: "infomaniak_delete_mailbox",
          description: "Delete mailbox. Two-phase confirmation.",
          annotations: { readOnlyHint: false, destructiveHint: true },
        },
        { mailbox_name: "info@example.com", confirmation_token: "token" },
        async () => {
          throw new Error("API refused the change");
        },
      ),
    ).rejects.toThrow(/API refused/u);

    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(5);

    const entries = await readAuditLog({ limit: 10 });
    expect(entries.map((entry) => entry.phase)).toEqual([
      "plan",
      "apply_attempt",
      "applied",
      "apply_attempt",
      "failed",
    ]);
    expect(entries[0]?.input).toMatchObject({
      mailbox_name: "info@example.com",
      sender: "spam@example.net",
      password: "[REDACTED]",
    });
    expect(JSON.stringify(entries)).not.toContain("secret-password");
    expect(JSON.stringify(entries)).not.toContain(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(entries[1]?.confirmed).toBe(true);
    expect(entries[4]?.error?.message).toBe("API refused the change");
  });

  it("can skip read-only success events while still logging failures", async () => {
    process.env["INFOMANIAK_AUDIT_LOG_INCLUDE_READS"] = "false";
    _resetConfigCache();

    await auditToolExecution(
      {
        name: "infomaniak_overview",
        description: "Read account overview.",
        annotations: { readOnlyHint: true },
      },
      {},
      async () => ({ total_accounts: 1 }),
    );

    await expect(
      auditToolExecution(
        {
          name: "infomaniak_overview",
          description: "Read account overview.",
          annotations: { readOnlyHint: true },
        },
        {},
        async () => {
          throw new Error("read failed");
        },
      ),
    ).rejects.toThrow(/read failed/u);

    const entries = await readAuditLog({ limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      tool: "infomaniak_overview",
      phase: "failed",
      risk: "read",
    });
  });
});
