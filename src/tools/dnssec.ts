import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import {
  consumeConfirmationToken,
  mintConfirmationToken,
} from "../runtime/confirmation-store.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const DnssecActionSchema = z
  .enum(["check", "enable", "disable"])
  .default("check")
  .describe(
    "Operation to perform. `check` is read-only (default). `enable`/`disable` are destructive and require the two-phase commit (confirmation_token).",
  );

const ManageDnssecInput = z.object({
  domain: z
    .string()
    .min(3)
    .describe(
      "Public domain to operate on (e.g. 'broz.be'). Must be a domain registered through or managed by this Infomaniak account.",
    ),
  action: DnssecActionSchema,
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Required for `enable`/`disable` after receiving a plan. Pass the token from the previous (plan) response within 60 seconds.",
    ),
});

const DnssecStatusSchema = z
  .object({
    has_dnssec: z.boolean(),
    dnssec_type: z.string().nullable().optional(),
    dnssec_data: z.unknown().optional(),
    ksk: z.unknown().optional(),
  })
  .passthrough();

const ManageDnssecOutput = z.union([
  // check returns current status
  DnssecStatusSchema.extend({ action: z.literal("check"), domain: z.string() }),
  // enable/disable without a token returns a plan
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      domain: z.string(),
      action: z.enum(["enable", "disable"]),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  // enable/disable with a token applies the change
  z.object({
    status: z.literal("applied"),
    domain: z.string(),
    action: z.enum(["enable", "disable"]),
    message: z.string(),
  }),
]);

const WARNINGS = {
  enable:
    "Misconfigured DNSSEC can take a domain offline. Make sure the parent zone is healthy first.",
  disable:
    "Disabling DNSSEC weakens the integrity of your domain's DNS responses. Only do this temporarily.",
};

export const manageDnssecTool = defineTool({
  name: "infomaniak_manage_dnssec",
  description:
    "Unified DNSSEC management for a domain: `check` (read state + KSK/DS records), `enable` (publish DS record at registry), or `disable` (remove DS record). `enable` and `disable` use a two-phase commit: the first call returns a plan + confirmation_token (TTL ~60s), the second call applies the change. Replaces the v0.9 trio `dnssec_check` / `dnssec_enable` / `dnssec_disable` with no loss of capability.",
  inputSchema: ManageDnssecInput,
  outputSchema: ManageDnssecOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();

    if (input.action === "check") {
      const data = await client.request<unknown>(
        "GET",
        `/2/domains/${encodeURIComponent(input.domain)}/dnssec/check`,
      );
      const parsed = DnssecStatusSchema.parse(data);
      return {
        ...parsed,
        action: "check" as const,
        domain: input.domain,
      };
    }

    const action = input.action;
    const fingerprint = JSON.stringify({
      tool: "infomaniak_manage_dnssec",
      domain: input.domain,
      action,
    });
    if (!input.confirmation_token) {
      const { token, expiresAt } = mintConfirmationToken(fingerprint);
      return {
        status: "plan" as const,
        plan: { domain: input.domain, action },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — DNSSEC ${action}`,
          ``,
          `- **Domain**: \`${input.domain}\``,
          ``,
          `### ⚠️ ${WARNINGS[action]}`,
          ``,
          `### Next step`,
          `Re-call with \`action: "${action}"\` and \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }
    if (!consumeConfirmationToken(input.confirmation_token, fingerprint)) {
      throw new Error(
        "Confirmation token is invalid, expired, or doesn't match the parameters.",
      );
    }
    await client.request<unknown>(
      "POST",
      `/2/domains/${encodeURIComponent(input.domain)}/dnssec/${action}`,
    );
    recordHistory({
      tool: "infomaniak_manage_dnssec",
      kind: action === "enable" ? "create_dns_record" : "delete_dns_record",
      summary: `DNSSEC ${action} on ${input.domain}`,
      payload: { domain: input.domain, action },
    });
    return {
      status: "applied" as const,
      domain: input.domain,
      action,
      message: `✅ DNSSEC ${action} requested on \`${input.domain}\`.`,
    };
  },
});
