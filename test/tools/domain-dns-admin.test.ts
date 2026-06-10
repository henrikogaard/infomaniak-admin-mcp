import { afterEach, describe, expect, it, vi } from "vitest";

import { auditDomainDnsAdminTool } from "../../src/tools/domain-dns-admin.js";

describe("infomaniak_audit_domain_dns_admin", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("flags DNSSEC, MX, SPF, DMARC, wildcard, and TTL posture for a domain zone", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/2/zones/example.com/records")) {
        return json([
          {
            id: 1,
            source: ".",
            type: "MX",
            target: "5 mta-gw.infomaniak.ch",
            ttl: 3600,
          },
          {
            id: 2,
            source: ".",
            type: "TXT",
            target: "v=spf1 include:spf.infomaniak.ch ~all",
            ttl: 3600,
          },
          { id: 3, source: "*", type: "A", target: "192.0.2.10", ttl: 60 },
        ]);
      }
      if (url.includes("/2/domains/example.com/dnssec/check")) {
        return json({ has_dnssec: false });
      }
      return json({});
    }) as typeof fetch;

    const result = (await auditDomainDnsAdminTool.handler({
      domain: "example.com",
    })) as {
      domain: string;
      zone: string;
      summary: {
        records: number;
        critical: number;
        warning: number;
        info: number;
      };
      findings: Array<{ category: string; severity: string }>;
    };

    expect(result.domain).toBe("example.com");
    expect(result.zone).toBe("example.com");
    expect(result.summary.records).toBe(3);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ category: "dnssec", severity: "warning" }),
        expect.objectContaining({ category: "dmarc", severity: "warning" }),
        expect.objectContaining({ category: "wildcard", severity: "warning" }),
        expect.objectContaining({ category: "low_ttl", severity: "info" }),
      ]),
    );
    expect(result.findings.some((finding) => finding.category === "mx")).toBe(
      false,
    );
    expect(result.findings.some((finding) => finding.category === "spf")).toBe(
      false,
    );
  });
});

function json(data: unknown): Response {
  return new Response(JSON.stringify({ result: "success", data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
