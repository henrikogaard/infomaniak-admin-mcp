import { randomUUID } from "node:crypto";

export type ActionKind =
  | "create_site"
  | "delete_site"
  | "create_dns_record"
  | "delete_dns_record"
  | "create_database"
  | "delete_database"
  | "request_certificate"
  | "delete_certificate"
  | "nodejs_app_action"
  | "update_mailbox_security"
  | "account_admin"
  | "mail_admin"
  | "kdrive_admin"
  | "kchat_admin"
  | "cancel_invitation";

export interface UndoSpec {
  tool: string;
  params: Record<string, unknown>;
  description: string;
}

export interface HistoryEntry {
  id: string;
  recorded_at: Date;
  tool: string;
  kind: ActionKind;
  summary: string;
  payload: Record<string, unknown>;
  undo: UndoSpec | undefined;
  undone: boolean;
}

const entries: HistoryEntry[] = [];

const MAX_ENTRIES = 200;

export function recordHistory(input: {
  tool: string;
  kind: ActionKind;
  summary: string;
  payload: Record<string, unknown>;
  undo?: UndoSpec;
}): HistoryEntry {
  const entry: HistoryEntry = {
    id: randomUUID(),
    recorded_at: new Date(),
    tool: input.tool,
    kind: input.kind,
    summary: input.summary,
    payload: input.payload,
    undo: input.undo,
    undone: false,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  return entry;
}

export function listHistory(limit = 50): ReadonlyArray<HistoryEntry> {
  return [...entries].slice(-limit).reverse();
}

export function getHistoryEntry(id: string): HistoryEntry | undefined {
  return entries.find((e) => e.id === id);
}

export function markUndone(id: string): boolean {
  const entry = entries.find((e) => e.id === id);
  if (!entry || entry.undone) {
    return false;
  }
  entry.undone = true;
  return true;
}

export function _resetHistory(): void {
  entries.length = 0;
}
