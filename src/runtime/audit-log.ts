import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import { loadConfig } from "../config.js";
import { getToolCapability } from "../tools/capabilities.js";
import type { ToolDefinition } from "../tools/types.js";

import { childLogger } from "./logger.js";

const log = childLogger({ module: "runtime/audit-log" });

export type AuditPhase =
  | "read"
  | "plan"
  | "apply_attempt"
  | "applied"
  | "failed"
  | "completed";
export type AuditRisk = "read" | "write" | "destructive";

export interface AuditLogEntry {
  id: string;
  ts: string;
  tool: string;
  phase: AuditPhase;
  risk: AuditRisk;
  scope: "admin" | "end_user" | "mixed";
  status: "success" | "error" | "attempt";
  confirmed: boolean;
  confirmation_token_present: boolean;
  input?: unknown;
  result_summary?: unknown;
  error?: { message: string; name?: string };
  duration_ms?: number;
}

export interface AuditReadOptions {
  limit: number;
  tool?: string | undefined;
  phase?: AuditPhase | undefined;
  risk?: AuditRisk | undefined;
  contains?: string | undefined;
  since?: string | undefined;
  until?: string | undefined;
}

const SECRET_KEY_PATTERN =
  /(?:token|authorization|cookie|sasession|xsrf|password|secret|private[_-]?key|certificate|credential)/iu;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 50;
const MAX_LOG_BYTES = 20 * 1024 * 1024;

export async function auditToolExecution<T>(
  tool: Pick<
    ToolDefinition,
    "name" | "description" | "annotations" | "capability"
  >,
  input: unknown,
  execute: () => Promise<T>,
): Promise<T> {
  const config = loadConfig();
  const capability = getToolCapability(tool as ToolDefinition);
  const confirmationTokenPresent = hasConfirmationToken(input);
  const shouldLogReadSuccess =
    capability.risk !== "read" || config.INFOMANIAK_AUDIT_LOG_INCLUDE_READS;
  const start = Date.now();

  if (!config.INFOMANIAK_AUDIT_LOG_ENABLED) {
    return await execute();
  }

  if (confirmationTokenPresent && capability.risk !== "read") {
    await appendAuditEntry({
      id: randomUUID(),
      ts: new Date().toISOString(),
      tool: tool.name,
      phase: "apply_attempt",
      risk: capability.risk,
      scope: capability.scope,
      status: "attempt",
      confirmed: true,
      confirmation_token_present: true,
      input: sanitizeForAudit(input),
    });
  }

  try {
    const result = await execute();
    const phase = classifyResultPhase(
      result,
      capability.risk,
      confirmationTokenPresent,
    );
    if (shouldLogReadSuccess || phase !== "read") {
      await appendAuditEntry({
        id: randomUUID(),
        ts: new Date().toISOString(),
        tool: tool.name,
        phase,
        risk: capability.risk,
        scope: capability.scope,
        status: "success",
        confirmed: confirmationTokenPresent,
        confirmation_token_present: confirmationTokenPresent,
        input: sanitizeForAudit(input),
        result_summary: summarizeResult(result),
        duration_ms: Date.now() - start,
      });
    }
    return result;
  } catch (error) {
    await appendAuditEntry({
      id: randomUUID(),
      ts: new Date().toISOString(),
      tool: tool.name,
      phase: "failed",
      risk: capability.risk,
      scope: capability.scope,
      status: "error",
      confirmed: confirmationTokenPresent,
      confirmation_token_present: confirmationTokenPresent,
      input: sanitizeForAudit(input),
      error: serializeError(error),
      duration_ms: Date.now() - start,
    });
    throw error;
  }
}

export async function readAuditLog(
  options: AuditReadOptions,
): Promise<AuditLogEntry[]> {
  const path = auditLogPath();
  const exists = await fileExists(path);
  if (!exists) {
    return [];
  }
  const stats = await stat(path);
  if (stats.size > MAX_LOG_BYTES) {
    return await readAuditLogStreaming(path, options);
  }
  const text = await readFile(path, "utf8");
  return filterAndLimitEntries(parseLines(text.split(/\r?\n/u)), options);
}

export function auditLogPath(): string {
  return resolve(loadConfig().INFOMANIAK_AUDIT_LOG_PATH);
}

async function appendAuditEntry(entry: AuditLogEntry): Promise<void> {
  const path = auditLogPath();
  try {
    await mkdir(dirname(path), { recursive: true });
    await appendFile(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    log.error({ err: error, path }, "Failed to append MCP audit log entry");
  }
}

async function readAuditLogStreaming(
  path: string,
  options: AuditReadOptions,
): Promise<AuditLogEntry[]> {
  const entries: AuditLogEntry[] = [];
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({
    input: stream,
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) {
    const entry = parseLine(line);
    if (entry && matchesFilters(entry, options)) {
      entries.push(entry);
      if (entries.length > options.limit) {
        entries.shift();
      }
    }
  }
  return entries;
}

function parseLines(lines: ReadonlyArray<string>): AuditLogEntry[] {
  const entries: AuditLogEntry[] = [];
  for (const line of lines) {
    const entry = parseLine(line);
    if (entry) {
      entries.push(entry);
    }
  }
  return entries;
}

function parseLine(line: string): AuditLogEntry | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as AuditLogEntry;
    if (typeof parsed.id === "string" && typeof parsed.tool === "string") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function filterAndLimitEntries(
  entries: ReadonlyArray<AuditLogEntry>,
  options: AuditReadOptions,
): AuditLogEntry[] {
  return entries
    .filter((entry) => matchesFilters(entry, options))
    .slice(-options.limit);
}

function matchesFilters(
  entry: AuditLogEntry,
  options: AuditReadOptions,
): boolean {
  if (options.tool && !entry.tool.includes(options.tool)) {
    return false;
  }
  if (options.phase && entry.phase !== options.phase) {
    return false;
  }
  if (options.risk && entry.risk !== options.risk) {
    return false;
  }
  if (options.since && entry.ts < options.since) {
    return false;
  }
  if (options.until && entry.ts > options.until) {
    return false;
  }
  if (
    options.contains &&
    !JSON.stringify(entry)
      .toLowerCase()
      .includes(options.contains.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function classifyResultPhase(
  result: unknown,
  risk: AuditRisk,
  confirmationTokenPresent: boolean,
): AuditPhase {
  if (isRecord(result) && result["status"] === "plan") {
    return "plan";
  }
  if (isRecord(result) && result["status"] === "applied") {
    return "applied";
  }
  if (risk === "read") {
    return "read";
  }
  return confirmationTokenPresent ? "applied" : "completed";
}

function summarizeResult(result: unknown): unknown {
  if (!isRecord(result)) {
    return { type: typeof result };
  }
  const summary: Record<string, unknown> = {};
  for (const key of [
    "status",
    "plan",
    "diff",
    "updated",
    "mutation",
    "summary",
    "summary_markdown",
    "message",
    "canceled",
    "skipped",
  ]) {
    if (key in result) {
      summary[key] = sanitizeForAudit(result[key]);
    }
  }
  if (Object.keys(summary).length === 0) {
    summary["keys"] = Object.keys(result).slice(0, 20);
  }
  return summary;
}

function sanitizeForAudit(value: unknown, key = ""): unknown {
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}...[TRUNCATED]`
      : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeForAudit(item));
    if (value.length > MAX_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_ARRAY_ITEMS} more item(s) truncated]`);
    }
    return items;
  }
  const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS);
  const sanitized: Record<string, unknown> = {};
  for (const [entryKey, entryValue] of entries) {
    sanitized[entryKey] = sanitizeForAudit(entryValue, entryKey);
  }
  const totalKeys = Object.keys(value).length;
  if (totalKeys > MAX_OBJECT_KEYS) {
    sanitized["__truncated_keys"] = totalKeys - MAX_OBJECT_KEYS;
  }
  return sanitized;
}

function hasConfirmationToken(input: unknown): boolean {
  return (
    isRecord(input) &&
    typeof input["confirmation_token"] === "string" &&
    input["confirmation_token"].length > 0
  );
}

function serializeError(error: unknown): { message: string; name?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.name ? { name: error.name } : {}),
    };
  }
  return { message: String(error) };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
