import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";

import { defineTool } from "./types.js";

const DomainDnsAdminAuditInput = z.object({
  domain: z
    .string()
    .min(3)
    .describe(
      "Registered domain to audit, e.g. example.com. Used for DNSSEC checks.",
    ),
  zone: z
    .string()
    .min(3)
    .optional()
    .describe("DNS zone to read. Defaults to the domain value."),
  low_ttl_threshold: z
    .number()
    .int()
    .min(60)
    .max(3600)
    .default(300)
    .describe(
      "TTL below this threshold is surfaced as info. Default 300 seconds.",
    ),
});

const DnsAdminFindingSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  category: z.string(),
  message: z.string(),
  record_id: z.number().optional(),
});

const DomainDnsAdminAuditOutput = z.object({
  domain: z.string(),
  zone: z.string(),
  dnssec: z.unknown(),
  summary: z.object({
    records: z.number(),
    critical: z.number(),
    warning: z.number(),
    info: z.number(),
  }),
  findings: z.array(DnsAdminFindingSchema),
  records: z.array(z.unknown()),
  summary_markdown: z.string(),
});

export const auditDomainDnsAdminTool = defineTool({
  name: "infomaniak_audit_domain_dns_admin",
  description:
    "Read-only domain/DNS admin posture audit: DNSSEC, MX, SPF, DMARC, wildcard records, and very low TTLs for an Infomaniak-managed zone.",
  inputSchema: DomainDnsAdminAuditInput,
  outputSchema: DomainDnsAdminAuditOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const zone = input.zone ?? input.domain;
    const lowTtlThreshold = input.low_ttl_threshold ?? 300;
    const client = new PublicApiClient();
    const [records, dnssec] = await Promise.all([
      client.request<unknown[]>(
        "GET",
        `/2/zones/${encodeURIComponent(zone)}/records`,
      ),
      client.request<unknown>(
        "GET",
        `/2/domains/${encodeURIComponent(input.domain)}/dnssec/check`,
      ),
    ]);

    const findings = buildDnsFindings(records, dnssec, lowTtlThreshold);
    const summary = {
      records: records.length,
      critical: findings.filter((finding) => finding.severity === "critical")
        .length,
      warning: findings.filter((finding) => finding.severity === "warning")
        .length,
      info: findings.filter((finding) => finding.severity === "info").length,
    };

    return {
      domain: input.domain,
      zone,
      dnssec,
      summary,
      findings,
      records,
      summary_markdown: renderDomainDnsAuditMarkdown(
        input.domain,
        zone,
        summary,
        findings,
      ),
    };
  },
});

function buildDnsFindings(
  records: ReadonlyArray<unknown>,
  dnssec: unknown,
  lowTtlThreshold: number,
): Array<z.infer<typeof DnsAdminFindingSchema>> {
  const findings: Array<z.infer<typeof DnsAdminFindingSchema>> = [];
  const hasMx = records.some((record) => recordType(record) === "MX");
  const hasSpf = records.some(
    (record) =>
      recordType(record) === "TXT" &&
      recordTarget(record).toLowerCase().includes("v=spf1"),
  );
  const hasDmarc = records.some(
    (record) =>
      recordType(record) === "TXT" &&
      recordSource(record).toLowerCase() === "_dmarc" &&
      recordTarget(record).toLowerCase().includes("v=dmarc1"),
  );

  if (readBooleanField(dnssec, "has_dnssec") === false) {
    findings.push({
      severity: "warning",
      category: "dnssec",
      message: "DNSSEC is not enabled for this domain.",
    });
  }
  if (!hasMx) {
    findings.push({
      severity: "warning",
      category: "mx",
      message: "No MX record found. Mail delivery may fail.",
    });
  }
  if (!hasSpf) {
    findings.push({
      severity: "warning",
      category: "spf",
      message: "No SPF TXT record found.",
    });
  }
  if (!hasDmarc) {
    findings.push({
      severity: "warning",
      category: "dmarc",
      message: "No _dmarc TXT policy found.",
    });
  }

  for (const record of records) {
    const source = recordSource(record);
    if (source === "*") {
      findings.push({
        severity: "warning",
        category: "wildcard",
        message:
          "Wildcard DNS record found. Review whether catch-all routing is intended.",
        ...(recordId(record) !== null
          ? { record_id: recordId(record) ?? undefined }
          : {}),
      });
    }
    const ttl = recordTtl(record);
    if (ttl !== null && ttl < lowTtlThreshold) {
      findings.push({
        severity: "info",
        category: "low_ttl",
        message: `TTL ${ttl}s is below ${lowTtlThreshold}s.`,
        ...(recordId(record) !== null
          ? { record_id: recordId(record) ?? undefined }
          : {}),
      });
    }
  }

  return findings;
}

function recordType(record: unknown): string {
  return readStringField(record, "type").toUpperCase();
}

function recordSource(record: unknown): string {
  return readStringField(record, "source");
}

function recordTarget(record: unknown): string {
  return readStringField(record, "target");
}

function recordTtl(record: unknown): number | null {
  const ttl = readField(record, "ttl");
  return typeof ttl === "number" ? ttl : null;
}

function recordId(record: unknown): number | null {
  const id = readField(record, "id");
  return typeof id === "number" ? id : null;
}

function readBooleanField(value: unknown, key: string): boolean | null {
  const field = readField(value, key);
  return typeof field === "boolean" ? field : null;
}

function readStringField(value: unknown, key: string): string {
  const field = readField(value, key);
  return typeof field === "string" ? field : "";
}

function readField(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return value[key];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function renderDomainDnsAuditMarkdown(
  domain: string,
  zone: string,
  summary: z.infer<typeof DomainDnsAdminAuditOutput>["summary"],
  findings: ReadonlyArray<z.infer<typeof DnsAdminFindingSchema>>,
): string {
  return [
    `# Domain/DNS admin audit — ${domain}`,
    ``,
    `Zone: ${zone}`,
    `Records: ${summary.records}`,
    ``,
    `- Critical: ${summary.critical}`,
    `- Warning: ${summary.warning}`,
    `- Info: ${summary.info}`,
    ``,
    ...findings.map(
      (finding) =>
        `- ${finding.severity.toUpperCase()} ${finding.category}: ${finding.message}`,
    ),
  ].join("\n");
}
