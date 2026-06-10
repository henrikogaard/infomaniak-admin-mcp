import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { ProductSchema } from "../schemas/infomaniak.js";
import { defaultAccountId } from "../runtime/account-cache.js";

import { defineTool } from "./types.js";

const InputSchema = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Organization/account ID. Optional: defaults to the first account the token has access to. Discover via infomaniak_overview.",
    ),
  days_ahead: z
    .number()
    .int()
    .min(1)
    .max(365)
    .default(60)
    .describe(
      "Flag products expiring within this many days as warnings. Default 60.",
    ),
  max_domain_checks: z
    .number()
    .int()
    .min(0)
    .max(500)
    .default(50)
    .describe(
      "Cap on the number of `/1/domain/{name}` lookups used to disambiguate stale `expired_at` flags on domain products. Each lookup is one API call. With the 60 req/min rate limit, leave this ≤ 50 unless you have time. Set to 0 to skip domain re-checks entirely (faster but may miss real expirations).",
    ),
});

const FindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  category: z.string(),
  message: z.string(),
  product_id: z.number().optional(),
  product_name: z.string().optional(),
});

const OutputSchema = z.object({
  account_id: z.number(),
  scanned_products: z.number(),
  findings: z.array(FindingSchema),
  summary_markdown: z.string(),
});

const SECONDS_PER_DAY = 86_400;

export const auditAccountTool = defineTool({
  name: "infomaniak_audit_account",
  description:
    "Scan an Infomaniak organization for actionable issues: products expiring soon, products in maintenance, locked products, ongoing operations.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const accountId = input.account_id ?? (await defaultAccountId());
    if (accountId === null) {
      throw new Error(
        "No account_id provided and the token reaches no accounts. Use infomaniak_overview to list available accounts.",
      );
    }
    const client = new PublicApiClient();
    const products = (
      await client.request<Array<unknown>>("GET", "/1/products", {
        query: { per_page: 500, account_id: accountId },
      })
    )
      .map((p) => ProductSchema.parse(p))
      .filter((p) => p.account_id === accountId);

    const now = Math.floor(Date.now() / 1000);
    const cutoff = now + input.days_ahead * SECONDS_PER_DAY;
    const findings: Array<z.infer<typeof FindingSchema>> = [];
    let domainChecksUsed = 0;

    for (const product of products) {
      const productName = `${product.service_name}: ${product.customer_name ?? "(unnamed)"}`;

      if (product.service_name === "domain" && product.customer_name) {
        if (domainChecksUsed >= input.max_domain_checks) {
          findings.push({
            severity: "info",
            category: "unverified_expiry",
            message: `Skipped live expiry check (max_domain_checks=${input.max_domain_checks} reached). Raise the cap or re-run with this domain in focus to verify.`,
            product_id: product.id,
            product_name: productName,
          });
          continue;
        }
        domainChecksUsed += 1;
        try {
          const liveDomain = await client.request<{
            data?: { expired_at?: number | null };
            expired_at?: number | null;
          }>("GET", `/1/domain/${encodeURIComponent(product.customer_name)}`);
          const liveExpiry =
            liveDomain.data?.expired_at !== undefined
              ? liveDomain.data.expired_at
              : liveDomain.expired_at;
          if (typeof liveExpiry === "number") {
            if (liveExpiry < now) {
              findings.push({
                severity: "critical",
                category: "expiration",
                message: `Expired ${formatDaysAgo(now - liveExpiry)} ago (live whois)`,
                product_id: product.id,
                product_name: productName,
              });
            } else if (liveExpiry < cutoff) {
              findings.push({
                severity: "warning",
                category: "expiration",
                message: `Expires in ${Math.round((liveExpiry - now) / SECONDS_PER_DAY)} days`,
                product_id: product.id,
                product_name: productName,
              });
            }
          } else {
            findings.push({
              severity: "info",
              category: "unverified_expiry",
              message:
                "Live expiry endpoint returned no value. The domain might be healthy (auto-renewed) or its DNS might not be managed by Infomaniak.",
              product_id: product.id,
              product_name: productName,
            });
          }
        } catch (err) {
          findings.push({
            severity: "info",
            category: "unverified_expiry",
            message: `Could not verify live expiry: ${err instanceof Error ? err.message : String(err)}`,
            product_id: product.id,
            product_name: productName,
          });
        }
      } else if (
        product.expired_at !== undefined &&
        product.expired_at !== null
      ) {
        if (product.expired_at < now) {
          findings.push({
            severity: "critical",
            category: "expiration",
            message: `Expired ${formatDaysAgo(now - product.expired_at)} ago`,
            product_id: product.id,
            product_name: productName,
          });
        } else if (product.expired_at < cutoff) {
          findings.push({
            severity: "warning",
            category: "expiration",
            message: `Expires in ${Math.round((product.expired_at - now) / SECONDS_PER_DAY)} days`,
            product_id: product.id,
            product_name: productName,
          });
        }
      }
      if (product.is_locked === true) {
        findings.push({
          severity: "warning",
          category: "locked",
          message: "Product is locked — admin attention required",
          product_id: product.id,
          product_name: productName,
        });
      }
      if (product.has_maintenance === true) {
        findings.push({
          severity: "info",
          category: "maintenance",
          message: "Product is in maintenance",
          product_id: product.id,
          product_name: productName,
        });
      }
      if (product.has_operation_in_progress === true) {
        findings.push({
          severity: "info",
          category: "operation_in_progress",
          message: "An operation is currently running on this product",
          product_id: product.id,
          product_name: productName,
        });
      }
    }

    findings.sort(
      (a, b) => severityWeight(b.severity) - severityWeight(a.severity),
    );

    const summaryMarkdown = renderSummary(accountId, products.length, findings);

    return {
      account_id: accountId,
      scanned_products: products.length,
      findings,
      summary_markdown: summaryMarkdown,
    };
  },
});

function severityWeight(severity: "info" | "warning" | "critical"): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function formatDaysAgo(seconds: number): string {
  const days = Math.round(seconds / SECONDS_PER_DAY);
  if (days <= 0) {
    return "today";
  }
  return days === 1 ? "1 day" : `${days} days`;
}

function renderSummary(
  accountId: number,
  scannedCount: number,
  findings: ReadonlyArray<z.infer<typeof FindingSchema>>,
): string {
  const lines = [
    `# Audit — account ${accountId}`,
    ``,
    `Scanned **${scannedCount}** products.`,
    ``,
  ];

  const criticals = findings.filter((f) => f.severity === "critical");
  const warnings = findings.filter((f) => f.severity === "warning");
  const infos = findings.filter((f) => f.severity === "info");

  if (criticals.length === 0 && warnings.length === 0 && infos.length === 0) {
    lines.push("✅ Nothing to report — everything looks healthy.");
    return lines.join("\n");
  }

  lines.push(
    `**${criticals.length}** critical · **${warnings.length}** warnings · **${infos.length}** info`,
    ``,
  );

  for (const [label, group] of [
    ["🔴 Critical", criticals],
    ["🟠 Warnings", warnings],
    ["🔵 Info", infos],
  ] as const) {
    if (group.length === 0) {
      continue;
    }
    lines.push(`## ${label}`, "");
    for (const finding of group) {
      lines.push(
        `- [\`${finding.category}\`] ${finding.product_name ?? "?"} — ${finding.message}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
