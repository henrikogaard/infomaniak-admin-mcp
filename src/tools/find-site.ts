import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { ProductSchema, SiteSchema } from "../schemas/infomaniak.js";
import { listAccountIds } from "../runtime/account-cache.js";

import { defineTool } from "./types.js";

const FindSiteInput = z.object({
  domain: z
    .string()
    .min(3)
    .describe(
      "Public domain to locate. Accepts root domains (broz.be) or sub-domains (crm.coden.lu). Punycode (xn--...) is fine.",
    ),
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Optional account_id to restrict the lookup. Omit to scan every account the token has access to.",
    ),
});

const FindSiteOutput = z.object({
  found: z.boolean(),
  domain: z.string(),
  account_id: z.number().optional(),
  hosting_id: z.number().optional(),
  hosting_label: z.string().optional(),
  site_id: z.number().optional(),
  site: SiteSchema.optional(),
  scanned_hostings: z.number(),
  hint: z.string().optional(),
});

export const findSiteTool = defineTool({
  name: "infomaniak_find_site",
  description:
    "Locate a domain (e.g. broz.be) in the Infomaniak account tree. Returns {account_id, hosting_id, site_id, hosting_label, full site object}. Use this BEFORE any tool that requires hosting_id + site_id (get_certificate, request_certificate, list_databases, etc.) when you only know the domain name. Significantly cheaper than calling list_hostings + list_sites manually because it short-circuits on the first match.",
  inputSchema: FindSiteInput,
  outputSchema: FindSiteOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new PublicApiClient();
    const target = input.domain.toLowerCase().trim();

    // Find accessible accounts.
    const accountIds: number[] = input.account_id
      ? [input.account_id]
      : await listAccountIds();

    let scanned = 0;

    // Scan hostings until the domain is found.
    for (const aid of accountIds) {
      const products = await client.request<Array<unknown>>(
        "GET",
        "/1/products",
        {
          query: { per_page: 500, account_id: aid },
        },
      );
      const hostings = products
        .map((p) => {
          try {
            return ProductSchema.parse(p);
          } catch {
            return null;
          }
        })
        // Web-hosting products use service_name "hosting".
        .filter(
          (p): p is NonNullable<typeof p> =>
            !!p && p.service_name === "hosting",
        );

      for (const hosting of hostings) {
        scanned += 1;
        let sites: Array<unknown>;
        try {
          sites = await client.request<Array<unknown>>(
            "GET",
            `/1/web_hostings/${hosting.id}/sites`,
            { query: { "with[]": "applications", page: 1, per_page: 100 } },
          );
        } catch {
          continue;
        }
        for (const raw of sites) {
          let site;
          try {
            site = SiteSchema.parse(raw);
          } catch {
            continue;
          }
          const fqdn = (site.main_fqdn ?? "").toLowerCase();
          const cust = (site.customer_name ?? "").toLowerCase();
          if (
            fqdn === target ||
            cust === target ||
            fqdn === target.replace(/^www\./, "") ||
            cust === target.replace(/^www\./, "")
          ) {
            return {
              found: true,
              domain: input.domain,
              account_id: aid,
              hosting_id: hosting.id,
              hosting_label: hosting.customer_name,
              site_id: site.id,
              site,
              scanned_hostings: scanned,
            };
          }
        }
      }
    }

    return {
      found: false,
      domain: input.domain,
      scanned_hostings: scanned,
      hint: "Domain not found in any reachable account. Possible causes: (1) domain is registered but no site is provisioned, (2) the API token does not have access to the account that owns it, (3) the domain is on a different provider. Try `infomaniak_get_domain` to check if it's at least a registered domain.",
    };
  },
});
