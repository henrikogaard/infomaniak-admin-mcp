import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const GenericMutationOutput = z
  .union([
    z
      .object({
        status: z.literal("plan"),
        confirmation_token: z.string(),
        token_expires_at: z.string(),
        next_step_markdown: z.string(),
      })
      .passthrough(),
    z
      .object({ status: z.literal("applied"), message: z.string() })
      .passthrough(),
  ])
  .describe("Two-phase confirmation result.");

const AccountResourceInput = z.object({
  resource: z.enum([
    "list_accounts",
    "get_account",
    "list_tags",
    "list_products",
    "list_services",
    "list_current_products",
    "list_basic_teams",
    "get_team",
    "list_team_users",
    "list_invitation_b2b",
  ]),
  account_id: z.number().int().positive().optional(),
  team_id: z.number().int().positive().optional(),
  invitation_id: z.number().int().positive().optional(),
});

export const getAccountResourcesTool = defineTool({
  name: "infomaniak_get_account_resources",
  description:
    "Read account inventory and governance drill-down resources: accounts, products, services, tags, basic teams, team members, and B2B invitation customers.",
  inputSchema: AccountResourceInput,
  outputSchema: z.object({ resource: z.string(), data: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    resource: input.resource,
    data: await new PublicApiClient().request<unknown>("GET", accountResourcePath(input)),
  }),
});

const AccountB2bInput = z
  .object({
    account_id: z.number().int().positive(),
    invitation_id: z.number().int().positive(),
    action: z.enum(["assign", "unassign"]),
    partnership_id: z.number().int().positive().optional(),
    payload: z.record(z.unknown()).default({}),
    confirmation_token: z.string().uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if (input.action === "unassign" && input.partnership_id === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["partnership_id"], message: "partnership_id is required when unassigning." });
    }
  });

export const manageAccountB2bTool = defineTool({
  name: "infomaniak_manage_account_invitation_b2b",
  description:
    "Assign or unassign B2B customer partnerships on an account invitation. Two-phase confirmation with a fresh partnership snapshot.",
  inputSchema: AccountB2bInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof AccountB2bInput>,
    unknown,
    { plan: { account_id: number; invitation_id: number; action: string; partnership_id?: number; payload: Record<string, unknown> }; current_partnerships: unknown },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_manage_account_invitation_b2b",
    loadCurrent: async (input) => readB2b(input.account_id, input.invitation_id),
    buildPlan: (input, current_partnerships) => ({
      plan: {
        account_id: input.account_id,
        invitation_id: input.invitation_id,
        action: input.action,
        ...(input.partnership_id === undefined ? {} : { partnership_id: input.partnership_id }),
        payload: input.payload,
      },
      current_partnerships,
    }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      const base = `/1/accounts/${input.account_id}/invitations/${input.invitation_id}/b2b`;
      const result = input.action === "assign"
        ? await client.request<unknown>("POST", base, { body: plan.plan.payload })
        : await client.request<unknown>("DELETE", `${base}/${input.partnership_id}`);
      recordHistory({
        tool: "infomaniak_manage_account_invitation_b2b",
        kind: "account_admin",
        summary: `${input.action}d B2B partnership on invitation ${input.invitation_id}`,
        payload: { account_id: input.account_id, invitation_id: input.invitation_id, action: input.action, partnership_id: input.partnership_id },
      });
      return { result, message: `✅ B2B invitation partnership ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — B2B invitation access",
      "",
      `- **Account**: ${plan.plan.account_id}`,
      `- **Invitation**: ${plan.plan.invitation_id}`,
      `- **Action**: ${plan.plan.action}`,
      ...(plan.plan.partnership_id === undefined ? [] : [`- **Partnership**: ${plan.plan.partnership_id}`]),
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

const DomainResourceInput = z.object({
  resource: z.enum([
    "list_domains",
    "get_domain",
    "dnssec_check",
    "list_zones",
    "show_zone",
    "zone_exists",
    "get_record",
    "check_record",
  ]),
  domain: z.string().min(3).optional(),
  zone: z.string().min(3).optional(),
  record_id: z.number().int().positive().optional(),
});

export const getDomainResourcesTool = defineTool({
  name: "infomaniak_get_domain_resources",
  description:
    "Read canonical v2 domain, zone, DNSSEC, and DNS-record resources from the Infomaniak public API.",
  inputSchema: DomainResourceInput,
  outputSchema: z.object({ resource: z.string(), data: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    resource: input.resource,
    data: await new PublicApiClient().request<unknown>("GET", domainResourcePath(input)),
  }),
});

const NameserverInput = z
  .object({
    domain: z.string().min(3),
    nameservers: z.array(z.string().min(1)).min(2).optional(),
    use_infomaniak_ns: z.boolean().optional(),
    verify_ns_availability: z.boolean().default(false),
    confirmation_token: z.string().uuid().optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.nameservers === undefined) === (input.use_infomaniak_ns === undefined)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nameservers"], message: "Provide exactly one of nameservers or use_infomaniak_ns." });
    }
  });

export const manageDomainNameserversTool = defineTool({
  name: "infomaniak_manage_domain_nameservers",
  description:
    "Update a domain's nameservers or restore Infomaniak nameservers. Two-phase confirmation with a current domain snapshot.",
  inputSchema: NameserverInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<
    z.infer<typeof NameserverInput>,
    unknown,
    { plan: { domain: string; payload: Record<string, unknown> }; current_domain: unknown },
    { result: unknown; message: string }
  >({
    toolName: "infomaniak_manage_domain_nameservers",
    loadCurrent: async (input) => new PublicApiClient().request<unknown>("GET", `/2/domains/domains/${encodeURIComponent(input.domain)}`),
    buildPlan: (input, current_domain) => ({
      plan: {
        domain: input.domain,
        payload: {
          ...(input.nameservers === undefined ? {} : { nameservers: input.nameservers }),
          ...(input.use_infomaniak_ns === undefined ? {} : { use_infomaniak_ns: input.use_infomaniak_ns }),
          verify_ns_availability: input.verify_ns_availability,
        },
      },
      current_domain,
    }),
    apply: async (input, plan) => {
      const result = await new PublicApiClient().request<unknown>(
        "PUT",
        `/2/domains/domains/${encodeURIComponent(input.domain)}/nameservers`,
        { body: plan.plan.payload },
      );
      recordHistory({
        tool: "infomaniak_manage_domain_nameservers",
        kind: "account_admin",
        summary: `Updated nameservers for ${input.domain}`,
        payload: { domain: input.domain, payload: plan.plan.payload },
      });
      return { result, message: `✅ Nameservers updated for ${input.domain}.` };
    },
    renderPlanMarkdown: (input, plan, token) => [
      "## Plan — update domain nameservers",
      "",
      `- **Domain**: ${plan.plan.domain}`,
      `- **Payload**: \`${JSON.stringify(plan.plan.payload)}\``,
      "- **Warning**: changing nameservers can interrupt DNS if the target nameservers are not configured.",
      "",
      `Re-call with the same parameters and \`confirmation_token: \"${token}\"\`.`,
    ].join("\n"),
  }),
});

function accountResourcePath(input: z.infer<typeof AccountResourceInput>): string {
  if (input.resource === "list_accounts") return "/1/accounts";
  if (input.resource === "list_current_products") return "/1/accounts/current/products";
  const account = requireId(input.account_id, "account_id");
  switch (input.resource) {
    case "get_account": return `/1/accounts/${account}`;
    case "list_tags": return `/1/accounts/${account}/tags`;
    case "list_products": return `/1/accounts/${account}/products`;
    case "list_services": return `/1/accounts/${account}/services`;
    case "list_basic_teams": return `/1/accounts/${account}/basic/teams`;
    case "get_team": return `/1/accounts/${account}/teams/${requireId(input.team_id, "team_id")}`;
    case "list_team_users": return `/1/accounts/${account}/teams/${requireId(input.team_id, "team_id")}/users`;
    case "list_invitation_b2b": return `/1/accounts/${account}/invitations/${requireId(input.invitation_id, "invitation_id")}/b2b`;
  }
}

function domainResourcePath(input: z.infer<typeof DomainResourceInput>): string {
  const domain = input.domain === undefined ? undefined : encodeURIComponent(input.domain);
  const zone = input.zone === undefined ? undefined : encodeURIComponent(input.zone);
  switch (input.resource) {
    case "list_domains": return "/2/domains/domains";
    case "get_domain": return `/2/domains/domains/${requireValue(domain, "domain")}`;
    case "dnssec_check": return `/2/domains/domains/${requireValue(domain, "domain")}/dnssec/check`;
    case "list_zones": return `/2/domains/domains/${requireValue(domain, "domain")}/zones`;
    case "show_zone": return `/2/zones/${requireValue(zone, "zone")}`;
    case "zone_exists": return `/2/zones/${requireValue(zone, "zone")}/exists`;
    case "get_record": return `/2/zones/${requireValue(zone, "zone")}/records/${requireId(input.record_id, "record_id")}`;
    case "check_record": return `/2/zones/${requireValue(zone, "zone")}/records/${requireId(input.record_id, "record_id")}/check`;
  }
}

async function readB2b(accountId: number, invitationId: number): Promise<unknown> {
  return new PublicApiClient().request<unknown>("GET", `/1/accounts/${accountId}/invitations/${invitationId}/b2b`);
}

function requireId(value: number | undefined, name: string): number {
  if (value === undefined) throw new Error(`${name} is required for this resource.`);
  return value;
}

function requireValue(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is required for this resource.`);
  return value;
}
