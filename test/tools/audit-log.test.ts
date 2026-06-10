import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import {
  auditLogSearchTool,
  auditLogTailTool,
} from "../../src/tools/audit-log.js";

const ORIGINAL_ENV = { ...process.env };

describe("audit log reader tools", () => {
  let directory: string;
  let auditPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "infomaniak-audit-tools-"));
    auditPath = join(directory, "logs", "audit.jsonl");
    mkdirSync(join(directory, "logs"), { recursive: true });
    process.env = { ...ORIGINAL_ENV };
    process.env["INFOMANIAK_API_TOKEN"] = "test-token-placeholder-".padEnd(
      40,
      "x",
    );
    process.env["INFOMANIAK_AUDIT_LOG_PATH"] = auditPath;
    _resetConfigCache();
    writeFileSync(
      auditPath,
      [
        JSON.stringify({
          id: "1",
          ts: "2026-06-08T08:00:00.000Z",
          tool: "infomaniak_overview",
          phase: "read",
          risk: "read",
          status: "success",
        }),
        JSON.stringify({
          id: "2",
          ts: "2026-06-08T08:01:00.000Z",
          tool: "infomaniak_block_sender",
          phase: "applied",
          risk: "write",
          status: "success",
          confirmed: true,
        }),
        JSON.stringify({
          id: "3",
          ts: "2026-06-08T08:02:00.000Z",
          tool: "infomaniak_delete_mailbox",
          phase: "failed",
          risk: "destructive",
          status: "error",
          error: { message: "denied" },
        }),
      ].join("\n") + "\n",
      "utf8",
    );
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    _resetConfigCache();
    rmSync(directory, { recursive: true, force: true });
  });

  it("tails the newest audit events", async () => {
    const result = (await auditLogTailTool.handler({ limit: 2 })) as {
      entries: Array<{ id: string; tool: string }>;
      path: string;
    };

    expect(result.path).toBe(auditPath);
    expect(result.entries.map((entry) => entry.id)).toEqual(["2", "3"]);
  });

  it("searches audit events by tool, risk, phase, and text", async () => {
    const result = (await auditLogSearchTool.handler({
      tool: "block",
      risk: "write",
      phase: "applied",
      contains: "sender",
      limit: 10,
    })) as { entries: Array<{ id: string; tool: string }> };

    expect(result.entries).toEqual([
      expect.objectContaining({
        id: "2",
        tool: "infomaniak_block_sender",
      }),
    ]);
  });
});
