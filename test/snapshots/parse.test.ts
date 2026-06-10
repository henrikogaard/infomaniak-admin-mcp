// Snapshot responses must still match each tool's output schema.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { tools } from "../../src/tools/index.js";

interface SnapshotFile {
  args: Record<string, unknown>;
  result: {
    result?: {
      content?: ReadonlyArray<{ type: string; text?: string }>;
      structuredContent?: unknown;
    };
    error?: { message?: string };
  };
}

const SNAPSHOT_DIR = join(__dirname, "responses");

function loadSnapshots(): Array<{
  name: string;
  tool: string;
  data: SnapshotFile;
}> {
  const files = readdirSync(SNAPSHOT_DIR).filter((f) => f.endsWith(".json"));
  return files.map((f) => {
    const [tool] = f.split("__");
    return {
      name: f,
      tool: tool ?? "",
      data: JSON.parse(
        readFileSync(join(SNAPSHOT_DIR, f), "utf8"),
      ) as SnapshotFile,
    };
  });
}

describe("snapshot parse regression", () => {
  const snapshots = loadSnapshots();

  // Snapshots without a current output schema are skipped.
  const RETIRED = new Set([
    "infomaniak_dnssec_check",
    "infomaniak_dnssec_enable",
    "infomaniak_dnssec_disable",
    "infomaniak_get_mailbox_aliases",
    "infomaniak_get_mailbox_signatures",
    "infomaniak_get_mailbox_backups",
  ]);

  it("captured at least 30 live responses", () => {
    expect(snapshots.length).toBeGreaterThan(30);
  });

  for (const snap of snapshots) {
    const tool = tools.find((t) => t.name === snap.tool);

    if (!tool) {
      // Retired tools stay in snapshots for historical coverage only.
      if (RETIRED.has(snap.tool)) continue;
      // Unknown snapshot names should be visible without breaking the suite.
      it.skip(`${snap.name} — tool not found`, () => undefined);
      continue;
    }

    it(`${snap.tool}: response parses through declared output schema`, () => {
      const content = snap.data.result.result?.content ?? [];
      const textItem = content.find(
        (c) => c.type === "text" && typeof c.text === "string",
      );
      if (!textItem?.text) return; // empty or non-text response

      const txt = textItem.text;
      // Error snapshots are not output-shape examples.
      if (txt.startsWith("❌")) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(txt);
      } catch {
        return; // text response, not JSON: nothing to validate
      }

      // The stored response must still match the declared output schema.
      const result = tool.outputSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues
          .slice(0, 3)
          .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
          .join("\n");
        throw new Error(
          `Output schema rejects live response.\nFirst issues:\n${issues}`,
        );
      }
    });
  }
});
