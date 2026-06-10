import { z } from "zod";

import { ManagerApiClient } from "../infomaniak/client.js";

import { defineTool } from "./types.js";

const DomainFullSchema = z
  .object({
    id: z.number(),
    customer_name: z.string(),
    puny_code: z.string().optional(),
    has_dnssec: z.boolean().optional(),
    has_error: z.boolean().optional(),
    has_trustee_contact: z.boolean().optional(),
    has_whois_antispam: z.boolean().optional(),
    info: z.unknown().nullable().optional(),
    is_city_domain: z.boolean().optional(),
    is_dns_managed_by_infomaniak: z.boolean().optional(),
    is_dnssec_pending: z.boolean().optional(),
    is_external: z.boolean().optional(),
    is_idn: z.boolean().optional(),
    is_part_of_ksuite: z.boolean().optional(),
    is_premium: z.boolean().optional(),
    is_service_mail_domain_alias: z.boolean().optional(),
    is_service_mail_on_other_account: z.boolean().optional(),
    is_synonym: z.boolean().optional(),
    auth_code: z.string().nullable().optional(),
    restorable: z.boolean().optional(),
    transfer_status: z.unknown().optional(),
    trade_status: z.unknown().optional(),
    termination: z.unknown().optional(),
    domain_status: z.unknown().optional(),
    glue_records: z.unknown().optional(),
    tld: z.unknown().optional(),
    registry: z.unknown().optional(),
    owner: z.unknown().optional(),
    service: z.unknown().optional(),
    dns: z.unknown().optional(),
    associated_products: z.array(z.unknown()).optional(),
    subdomain_associated_products: z.array(z.unknown()).optional(),
    has_mail: z.boolean().optional(),
    has_infomaniak_dns: z.boolean().optional(),
    use_custom_url: z.boolean().optional(),
    diagnostic_dns: z.unknown().optional(),
    dns_logs_api_url: z.string().nullable().optional(),
    authcode_quota: z.unknown().optional(),
    extra_fields: z.unknown().optional(),
    options: z.unknown().optional(),
    rights: z.record(z.boolean()).optional(),
    error: z.unknown().nullable().optional(),
    synonym: z.unknown().optional(),
    synonyms: z.array(z.unknown()).optional(),
    users: z.array(z.unknown()).optional(),
    status: z.unknown().optional(),
    product: z.unknown().optional(),
  })
  .passthrough();

const GetDomainFullInput = z.object({
  domain: z
    .string()
    .describe(
      "Either the numeric domain id (e.g. '1938345') OR the FQDN (e.g. 'agensea.net'). Both work. Discover via infomaniak_list_domains.",
    ),
});

export const getDomainFullTool = defineTool({
  name: "infomaniak_get_domain_full",
  description:
    "Full domain detail including auth_code (EPP transfer code), transfer_status, trade_status, termination state, glue records, TLD/registry info, attached service (web hosting), DNS detail, DNS health diagnostic, owner (registrant), associated products on the domain AND its subdomains, and the DNS logs API URL. Accepts either domain_id or FQDN. Manager-private.",
  inputSchema: GetDomainFullInput,
  outputSchema: DomainFullSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof DomainFullSchema>>(
      "GET",
      `/proxy/1/domain/${encodeURIComponent(input.domain)}`,
      { query: { "with[]": "*" } },
    );
  },
});
