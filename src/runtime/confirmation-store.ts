import { randomUUID } from "node:crypto";

import { loadConfig } from "../config.js";

interface TokenRecord {
  token: string;
  fingerprint: string;
  expiresAt: number;
}

const records = new Map<string, TokenRecord>();

export function mintConfirmationToken(fingerprint: string): {
  token: string;
  expiresAt: Date;
} {
  purgeExpiredTokens();
  const ttlMs = loadConfig().CONFIRMATION_TTL_SECONDS * 1000;
  const token = randomUUID();
  const expiresAt = Date.now() + ttlMs;
  records.set(token, { token, fingerprint, expiresAt });
  return { token, expiresAt: new Date(expiresAt) };
}

export function consumeConfirmationToken(
  token: string,
  fingerprint: string,
): boolean {
  purgeExpiredTokens();
  const record = records.get(token);
  if (!record) {
    return false;
  }
  if (record.fingerprint !== fingerprint) {
    return false;
  }
  records.delete(token);
  return true;
}

function purgeExpiredTokens(): void {
  const now = Date.now();
  for (const [token, record] of records) {
    if (record.expiresAt < now) {
      records.delete(token);
    }
  }
}

export function _resetConfirmationTokens(): void {
  records.clear();
}
