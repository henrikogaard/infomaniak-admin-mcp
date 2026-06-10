import { z } from "zod";

import { auditLogPath, readAuditLog } from "../runtime/audit-log.js";

import { defineTool } from "./types.js";

const AuditPhaseSchema = z.enum([
  "read",
  "plan",
  "apply_attempt",
  "applied",
  "failed",
  "completed",
]);
const AuditRiskSchema = z.enum(["read", "write", "destructive"]);

const AuditLogEntrySchema = z
  .object({
    id: z.string(),
    ts: z.string(),
    tool: z.string(),
    phase: AuditPhaseSchema,
    risk: AuditRiskSchema,
    scope: z.enum(["admin", "end_user", "mixed"]),
    status: z.enum(["success", "error", "attempt"]),
    confirmed: z.boolean(),
    confirmation_token_present: z.boolean(),
    input: z.unknown().optional(),
    result_summary: z.unknown().optional(),
    error: z
      .object({
        message: z.string(),
        name: z.string().optional(),
      })
      .optional(),
    duration_ms: z.number().optional(),
  })
  .passthrough();

const TailInput = z.object({
  limit: z.number().int().min(1).max(500).default(50),
});

const SearchInput = z.object({
  limit: z.number().int().min(1).max(500).default(50),
  tool: z.string().min(1).optional().describe("Substring match on tool name."),
  phase: AuditPhaseSchema.optional(),
  risk: AuditRiskSchema.optional(),
  contains: z
    .string()
    .min(1)
    .optional()
    .describe("Case-insensitive search across JSON entry."),
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
});

const AuditLogOutput = z.object({
  path: z.string(),
  count: z.number(),
  entries: z.array(AuditLogEntrySchema),
});

export const auditLogTailTool = defineTool({
  name: "infomaniak_audit_log_tail",
  description:
    "Read the newest entries from the persistent MCP audit log. Use this to inspect recent tool calls, write confirmations, applied changes, and failures.",
  inputSchema: TailInput,
  outputSchema: AuditLogOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const entries = await readAuditLog({ limit: input.limit ?? 50 });
    return {
      path: auditLogPath(),
      count: entries.length,
      entries,
    };
  },
});

export const auditLogSearchTool = defineTool({
  name: "infomaniak_audit_log_search",
  description:
    "Search the persistent MCP audit log by tool name, phase, risk, timestamp range, or free text. Useful for answering 'what changed today?' and 'did anything destructive run?'",
  inputSchema: SearchInput,
  outputSchema: AuditLogOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const entries = await readAuditLog({
      limit: input.limit ?? 50,
      tool: input.tool,
      phase: input.phase,
      risk: input.risk,
      contains: input.contains,
      since: input.since,
      until: input.until,
    });
    return {
      path: auditLogPath(),
      count: entries.length,
      entries,
    };
  },
});
