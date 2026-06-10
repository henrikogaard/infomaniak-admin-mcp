import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetConfigCache } from "../../src/config.js";
import {
  _resetConfirmationTokens,
  consumeConfirmationToken,
  mintConfirmationToken,
} from "../../src/runtime/confirmation-store.js";

describe("confirmation tokens", () => {
  beforeEach(() => {
    process.env["INFOMANIAK_API_TOKEN"] = "x".repeat(40);
    process.env["CONFIRMATION_TTL_SECONDS"] = "60";
    _resetConfigCache();
    _resetConfirmationTokens();
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetConfirmationTokens();
  });

  it("mints unique tokens for the same fingerprint", () => {
    const a = mintConfirmationToken("op:a");
    const b = mintConfirmationToken("op:a");
    expect(a.token).not.toBe(b.token);
  });

  it("consumes a token successfully when the fingerprint matches", () => {
    const { token } = mintConfirmationToken("op:create");
    expect(consumeConfirmationToken(token, "op:create")).toBe(true);
  });

  it("refuses to consume a token whose fingerprint changed", () => {
    const { token } = mintConfirmationToken("op:create:fqdn=A");
    expect(consumeConfirmationToken(token, "op:create:fqdn=B")).toBe(false);
    // A wrong fingerprint must not spend the token.
    expect(consumeConfirmationToken(token, "op:create:fqdn=A")).toBe(true);
  });

  it("is single-use: a successful consume invalidates the token", () => {
    const { token } = mintConfirmationToken("op:apply");
    expect(consumeConfirmationToken(token, "op:apply")).toBe(true);
    expect(consumeConfirmationToken(token, "op:apply")).toBe(false);
  });

  it("expires after the configured TTL", () => {
    vi.useFakeTimers();
    process.env["CONFIRMATION_TTL_SECONDS"] = "30";
    _resetConfigCache();

    const { token, expiresAt } = mintConfirmationToken("op:expiring");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());

    vi.advanceTimersByTime(31_000);
    expect(consumeConfirmationToken(token, "op:expiring")).toBe(false);
  });

  it("rejects unknown tokens", () => {
    expect(consumeConfirmationToken("never-minted", "op:foo")).toBe(false);
  });
});
