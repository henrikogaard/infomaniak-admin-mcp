import { z } from "zod";

import { defineTool } from "./types.js";

type Classification =
  | "covered"
  | "admin_candidate"
  | "dangerous_write"
  | "end_user_out_of_scope"
  | "unknown";

interface DocsEndpoint {
  category_path: string[];
  summary: string;
  method: string;
  endpoint: string;
}

interface NavigationNode {
  label?: unknown;
  items?: unknown;
  sub_categories?: unknown;
}

const CoverageInput = z.object({
  docs_url: z
    .string()
    .url()
    .default("https://developer.infomaniak.com/docs/api")
    .describe("Infomaniak developer portal API reference URL to inspect."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum candidates returned."),
});

const CoverageEndpointSchema = z.object({
  method: z.string(),
  endpoint: z.string(),
  summary: z.string(),
  category_path: z.array(z.string()),
  classification: z.enum([
    "covered",
    "admin_candidate",
    "dangerous_write",
    "end_user_out_of_scope",
    "unknown",
  ]),
  covered_by: z.array(z.string()),
});

const CoverageOutput = z.object({
  docs_url: z.string(),
  total_endpoints: z.number(),
  generated_at: z.string(),
  summary: z.record(z.number()),
  covered_examples: z.array(CoverageEndpointSchema),
  candidates: z.array(CoverageEndpointSchema),
  out_of_scope_examples: z.array(CoverageEndpointSchema),
  summary_markdown: z.string(),
});

export const apiCoverageReportTool = defineTool({
  name: "infomaniak_api_coverage_report",
  description:
    "Fetch the Infomaniak developer portal navigation and report MCP endpoint coverage, admin candidates, risky writes, and user-focused surfaces that are intentionally out of scope.",
  inputSchema: CoverageInput,
  outputSchema: CoverageOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const response = await fetch(input.docs_url, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    if (!response.ok) {
      throw new Error(
        `Could not fetch Infomaniak docs (${response.status}) from ${input.docs_url}`,
      );
    }
    const html = await response.text();
    const endpoints = collectDocsEndpoints(extractNavigation(html));
    const { tools } = await import("./index.js");
    const knownToolNames = new Set(tools.map((tool) => tool.name));

    const classified = endpoints.map((endpoint) => {
      const coveredBy = findCoveredBy(endpoint, knownToolNames);
      const classification = classifyEndpoint(endpoint, coveredBy);
      return {
        ...endpoint,
        classification,
        covered_by: coveredBy,
      };
    });

    const summary = summarize(classified);
    const coveredExamples = classified
      .filter((endpoint) => endpoint.classification === "covered")
      .slice(0, input.limit);
    const candidates = classified
      .filter(
        (endpoint) =>
          endpoint.classification === "admin_candidate" ||
          endpoint.classification === "dangerous_write",
      )
      .slice(0, input.limit);
    const outOfScopeExamples = classified
      .filter((endpoint) => endpoint.classification === "end_user_out_of_scope")
      .slice(0, Math.min(input.limit, 10));

    return {
      docs_url: input.docs_url,
      total_endpoints: endpoints.length,
      generated_at: new Date().toISOString(),
      summary,
      covered_examples: coveredExamples,
      candidates,
      out_of_scope_examples: outOfScopeExamples,
      summary_markdown: renderCoverageMarkdown(
        input.docs_url,
        summary,
        coveredExamples,
        candidates,
        outOfScopeExamples,
      ),
    };
  },
});

function extractNavigation(html: string): unknown {
  const match = html.match(/<div[^>]+id=["']app["'][^>]+data-page="([^"]+)"/u);
  if (!match?.[1]) {
    throw new Error(
      "Could not find the Inertia data-page payload in the Infomaniak docs HTML.",
    );
  }
  const dataPage = JSON.parse(decodeHtmlAttribute(match[1])) as {
    props?: { navigation?: unknown };
  };
  if (!dataPage.props || !("navigation" in dataPage.props)) {
    throw new Error(
      "Infomaniak docs payload did not include props.navigation.",
    );
  }
  return dataPage.props.navigation;
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function collectDocsEndpoints(navigation: unknown): DocsEndpoint[] {
  const endpoints: DocsEndpoint[] = [];
  if (!isRecord(navigation)) {
    return endpoints;
  }
  for (const [label, node] of Object.entries(navigation)) {
    collectNode(node, [label], endpoints);
  }
  return endpoints;
}

function collectNode(
  node: unknown,
  path: string[],
  endpoints: DocsEndpoint[],
): void {
  if (!isRecord(node)) {
    return;
  }
  const navNode = node as NavigationNode;
  if (Array.isArray(navNode.items)) {
    for (const item of navNode.items) {
      const endpoint = parseEndpoint(item, path);
      if (endpoint) {
        endpoints.push(endpoint);
      }
    }
  }
  if (isRecord(navNode.sub_categories)) {
    for (const [label, child] of Object.entries(navNode.sub_categories)) {
      collectNode(child, [...path, label], endpoints);
    }
  }
}

function parseEndpoint(
  item: unknown,
  categoryPath: string[],
): DocsEndpoint | null {
  if (!isRecord(item)) {
    return null;
  }
  const method = item["method"];
  const endpoint = item["endpoint"];
  const summary = item["summary"];
  if (typeof method !== "string" || typeof endpoint !== "string") {
    return null;
  }
  return {
    category_path: categoryPath,
    summary: typeof summary === "string" ? summary : "",
    method: method.toLowerCase(),
    endpoint,
  };
}

function classifyEndpoint(
  endpoint: DocsEndpoint,
  coveredBy: string[],
): Classification {
  const pathText =
    `${endpoint.category_path.join(" ")} ${endpoint.endpoint} ${endpoint.summary}`
      .toLowerCase()
      .replaceAll("&gt;", ">");
  if (endpoint.endpoint.startsWith("/1/kmeet") || pathText.includes("kmeet")) {
    return "end_user_out_of_scope";
  }
  if (endpoint.endpoint.startsWith("/api/v4/")) {
    if (isKchatUserFocused(pathText)) {
      return "end_user_out_of_scope";
    }
    if (isKchatAdminRelevant(pathText)) {
      if (isWriteMethod(endpoint.method)) {
        return "dangerous_write";
      }
      if (coveredBy.length > 0) {
        return "covered";
      }
      return "admin_candidate";
    }
    return "end_user_out_of_scope";
  }
  if (isWriteMethod(endpoint.method) && isAdminRelevant(pathText)) {
    return "dangerous_write";
  }
  if (coveredBy.length > 0) {
    return "covered";
  }
  if (isAdminRelevant(pathText)) {
    return "admin_candidate";
  }
  return "unknown";
}

function pathMatches(
  endpoint: DocsEndpoint,
  path: string,
  methods?: string | ReadonlyArray<string>,
): boolean {
  if (endpoint.endpoint !== path) {
    return false;
  }
  if (methods === undefined) {
    return true;
  }
  return Array.isArray(methods)
    ? methods.includes(endpoint.method)
    : endpoint.method === methods;
}

function findCoveredBy(
  endpoint: DocsEndpoint,
  knownToolNames: ReadonlySet<string>,
): string[] {
  const matches: string[] = [];
  const candidateMap: Array<[boolean, string]> = [
    [endpoint.endpoint === "/1/products", "infomaniak_audit_account"],
    [
      endpoint.endpoint === "/2/accounts/{account}/users",
      "infomaniak_list_account_users",
    ],
    [
      endpoint.endpoint === "/2/accounts/{account}/users/{user}/app_accesses",
      "infomaniak_get_user_app_accesses",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/invitations/users/{user}",
      "infomaniak_plan_user_offboarding",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/invitations/{invitation}" &&
        endpoint.method === "delete",
      "infomaniak_cancel_user_pending_invitations",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/invitations" &&
        endpoint.method === "post",
      "infomaniak_create_account_invitation",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/invitations/{invitation}" &&
        endpoint.method === "patch",
      "infomaniak_update_account_invitation",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/invitations/{invitation}" &&
        endpoint.method === "delete",
      "infomaniak_delete_account_invitation",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/invitations/{invitation}" &&
        endpoint.method === "get",
      "infomaniak_get_account_invitation_access",
    ],
    [
      endpoint.endpoint ===
        "/1/accounts/{account}/invitations/{invitation}/ksuite" &&
        (endpoint.method === "post" || endpoint.method === "delete"),
      "infomaniak_manage_account_invitation_access",
    ],
    [
      endpoint.endpoint ===
        "/1/accounts/{account}/invitations/{invitation}/drive" &&
        endpoint.method === "post",
      "infomaniak_manage_account_invitation_access",
    ],
    [
      endpoint.endpoint ===
        "/1/accounts/{account}/invitations/{invitation}/drive/{drive_id}" &&
        (endpoint.method === "patch" || endpoint.method === "delete"),
      "infomaniak_manage_account_invitation_access",
    ],
    [
      endpoint.endpoint ===
        "/1/accounts/{account}/invitations/{invitation}/mailbox/{mail_id}" &&
        (endpoint.method === "post" ||
          endpoint.method === "patch" ||
          endpoint.method === "delete"),
      "infomaniak_manage_account_invitation_access",
    ],
    [
      endpoint.endpoint ===
        "/1/accounts/{account}/invitations/{invitation}/mailbox/invite" &&
        endpoint.method === "post",
      "infomaniak_manage_account_invitation_access",
    ],
    [
      endpoint.endpoint ===
        "/1/accounts/{account}/invitations/{invitation}/kchat" &&
        endpoint.method === "patch",
      "infomaniak_manage_account_invitation_access",
    ],
    [
      endpoint.endpoint === "/api/v4/channels" && endpoint.method === "get",
      "infomaniak_list_kchat_channels",
    ],
    [
      endpoint.endpoint === "/api/v4/teams/{team_id}/channels" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_team_channels",
    ],
    [
      endpoint.endpoint === "/api/v4/teams/{team_id}/channels/private" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_team_channels",
    ],
    [
      endpoint.endpoint === "/api/v4/teams/{team_id}/channels/deleted" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_team_channels",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}" &&
        endpoint.method === "get",
      "infomaniak_get_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/members" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_channel_members",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/members/{user_id}" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_channel_members",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/moderations" &&
        endpoint.method === "get",
      "infomaniak_get_kchat_channel_moderation",
    ],
    [
      endpoint.endpoint === "/api/v4/groups" && endpoint.method === "get",
      "infomaniak_list_kchat_groups",
    ],
    [
      endpoint.endpoint === "/api/v4/teams/{team_id}/groups" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_groups",
    ],
    [
      endpoint.endpoint === "/api/v4/teams/{team_id}/groups_by_channels" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_groups",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/groups" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_groups",
    ],
    [
      endpoint.endpoint === "/api/v4/users/{user_id}/groups" &&
        endpoint.method === "get",
      "infomaniak_list_kchat_groups",
    ],
    [
      endpoint.endpoint === "/api/v4/bots" && endpoint.method === "get",
      "infomaniak_list_kchat_bots",
    ],
    [
      endpoint.endpoint === "/api/v4/bots/{bot_user_id}" &&
        endpoint.method === "get",
      "infomaniak_get_kchat_bot",
    ],
    [
      endpoint.endpoint === "/api/v4/commands" && endpoint.method === "get",
      "infomaniak_list_kchat_commands",
    ],
    [
      endpoint.endpoint === "/api/v4/commands/{command_id}" &&
        endpoint.method === "get",
      "infomaniak_get_kchat_command",
    ],
    [
      endpoint.endpoint === "/api/v4/roles" && endpoint.method === "get",
      "infomaniak_list_kchat_roles",
    ],
    [
      endpoint.endpoint === "/api/v4/channels" && endpoint.method === "post",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}" &&
        (endpoint.method === "put" || endpoint.method === "delete"),
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/patch" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/restore" &&
        endpoint.method === "post",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/move" &&
        endpoint.method === "post",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/privacy" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/scheme" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/moderations/patch" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/members" &&
        endpoint.method === "post",
      "infomaniak_manage_kchat_channel_members",
    ],
    [
      endpoint.endpoint === "/api/v4/channels/{channel_id}/members/{user_id}" &&
        endpoint.method === "delete",
      "infomaniak_manage_kchat_channel_members",
    ],
    [
      endpoint.endpoint ===
        "/api/v4/channels/{channel_id}/members/{user_id}/roles" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel_members",
    ],
    [
      endpoint.endpoint ===
        "/api/v4/channels/{channel_id}/members/{user_id}/schemeRoles" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel_members",
    ],
    [
      endpoint.endpoint ===
        "/api/v4/channels/{channel_id}/members/{user_id}/notify_props" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_channel_members",
    ],
    [
      endpoint.endpoint === "/api/v4/bots" && endpoint.method === "post",
      "infomaniak_manage_kchat_bot",
    ],
    [
      endpoint.endpoint === "/api/v4/bots/{bot_user_id}" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_bot",
    ],
    [
      endpoint.endpoint === "/api/v4/bots/{bot_user_id}" &&
        endpoint.method === "delete",
      "infomaniak_manage_kchat_bot",
    ],
    [
      endpoint.endpoint === "/api/v4/bots/{bot_user_id}/enable" &&
        endpoint.method === "post",
      "infomaniak_manage_kchat_bot",
    ],
    [
      endpoint.endpoint === "/api/v4/bots/{bot_user_id}/disable" &&
        endpoint.method === "post",
      "infomaniak_manage_kchat_bot",
    ],
    [
      endpoint.endpoint === "/api/v4/commands" && endpoint.method === "post",
      "infomaniak_manage_kchat_command",
    ],
    [
      endpoint.endpoint === "/api/v4/commands/{command_id}" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_command",
    ],
    [
      endpoint.endpoint === "/api/v4/commands/{command_id}" &&
        endpoint.method === "delete",
      "infomaniak_manage_kchat_command",
    ],
    [
      endpoint.endpoint === "/api/v4/commands/{command_id}/regen_token" &&
        endpoint.method === "put",
      "infomaniak_manage_kchat_command",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/teams" &&
        endpoint.method === "get",
      "infomaniak_list_teams_and_tags",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/teams" &&
        endpoint.method === "post",
      "infomaniak_create_account_team",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/teams/{team}" &&
        endpoint.method === "patch",
      "infomaniak_update_account_team",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/teams/{team}" &&
        endpoint.method === "delete",
      "infomaniak_delete_account_team",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/teams/{team}/users" &&
        endpoint.method === "post",
      "infomaniak_add_account_team_users",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/teams/{team}/users" &&
        endpoint.method === "delete",
      "infomaniak_remove_account_team_users",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/tags" &&
        endpoint.method === "get",
      "infomaniak_list_teams_and_tags",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/tags" &&
        endpoint.method === "post",
      "infomaniak_create_account_tag",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/tags/{tag}" &&
        endpoint.method === "put",
      "infomaniak_update_account_tag",
    ],
    [
      endpoint.endpoint === "/1/accounts/{account}/tags/{tag}" &&
        endpoint.method === "delete",
      "infomaniak_delete_account_tag",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}" &&
        endpoint.method === "get",
      "infomaniak_get_mailbox_security",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}" &&
        (endpoint.method === "put" || endpoint.method === "patch"),
      "infomaniak_set_mailbox_spam_policy",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters" &&
        endpoint.method === "get",
      "infomaniak_list_mailbox_filters",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters" &&
        endpoint.method === "get",
      "infomaniak_list_mailbox_filter_scripts",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters" &&
        endpoint.method === "post",
      "infomaniak_create_mailbox_filter",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters" &&
        endpoint.method === "patch",
      "infomaniak_update_mailbox_filter",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters" &&
        endpoint.method === "delete",
      "infomaniak_delete_mailbox_filter",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters/scripts" &&
        (endpoint.method === "post" || endpoint.method === "patch"),
      "infomaniak_upsert_mailbox_filter_script",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters/scripts" &&
        endpoint.method === "delete",
      "infomaniak_delete_mailbox_filter_script",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders" &&
        endpoint.method === "put",
      "infomaniak_update_mailbox_folders",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders/spam" &&
        endpoint.method === "delete",
      "infomaniak_purge_spam_folder",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/aliases" &&
        endpoint.method === "get",
      "infomaniak_manage_mailbox_aliases",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/aliases" &&
        (endpoint.method === "put" || endpoint.method === "post"),
      "infomaniak_manage_mailbox_aliases",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/aliases/{alias}" &&
        endpoint.method === "delete",
      "infomaniak_manage_mailbox_aliases",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/forwarding_addresses" &&
        endpoint.method === "get",
      "infomaniak_manage_mailbox_forwarding",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/forwarding_addresses" &&
        (endpoint.method === "put" ||
          endpoint.method === "post" ||
          endpoint.method === "delete"),
      "infomaniak_manage_mailbox_forwarding",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/forwarding_addresses/{redirect_addresses}" &&
        endpoint.method === "delete",
      "infomaniak_manage_mailbox_forwarding",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auto_reply/model" &&
        endpoint.method === "get",
      "infomaniak_manage_mailbox_auto_reply",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auto_reply/model" &&
        endpoint.method === "post",
      "infomaniak_manage_mailbox_auto_reply",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auto_reply/reset" &&
        endpoint.method === "put",
      "infomaniak_manage_mailbox_auto_reply",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auto_reply/model/{model_id}" &&
        (endpoint.method === "patch" ||
          endpoint.method === "delete" ||
          endpoint.method === "get"),
      "infomaniak_manage_mailbox_auto_reply",
    ],
    [
      endpoint.endpoint === "/1/mail_hostings/{mail_hosting_id}/redirections" &&
        endpoint.method === "get",
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint === "/1/mail_hostings/{mail_hosting_id}/redirections" &&
        endpoint.method === "post",
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}" &&
        (endpoint.method === "get" ||
          endpoint.method === "put" ||
          endpoint.method === "delete"),
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}/enable" &&
        endpoint.method === "put",
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}/send-confirmation-requests" &&
        endpoint.method === "put",
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}/targets" &&
        (endpoint.method === "get" ||
          endpoint.method === "post" ||
          endpoint.method === "delete"),
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/redirections/{redirection_id}/targets/{target_id}/resend-confirmation-request" &&
        endpoint.method === "put",
      "infomaniak_manage_service_redirections",
    ],
    [
      endpoint.endpoint ===
        "/1/mail_hostings/{mail_hosting_id}/diagnostic/dkim/rotate" &&
        (endpoint.method === "get" || endpoint.method === "post"),
      "infomaniak_rotate_mail_dkim",
    ],
    // Mail signatures and templates
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/{signature}",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/{signature}",
        ["patch", "delete"],
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/set_defaults",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/upload",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/templates",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/templates",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/templates/{signature_template}",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/templates/{signature_template}",
        ["put", "delete"],
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/signatures/templates/{signature_template}/create_signatures",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates/default",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates/{signature_template}",
        "get",
      ),
      "infomaniak_get_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates/{signature_template}",
        ["put", "delete"],
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates/{signature_template}/create_signatures",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{mail_hosting_id}/signatures/templates/upload",
        "post",
      ),
      "infomaniak_manage_mail_signatures",
    ],
    // Webmail access
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail",
        "get",
      ),
      "infomaniak_get_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/users",
        "get",
      ),
      "infomaniak_get_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/users/{user_id}/team_accesses",
        "get",
      ),
      "infomaniak_get_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/teams/{team_id}/individual_users",
        "get",
      ),
      "infomaniak_get_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail",
        "post",
      ),
      "infomaniak_manage_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/users/{user_id}",
        ["patch", "delete"],
      ),
      "infomaniak_manage_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/teams/bulk",
        "post",
      ),
      "infomaniak_manage_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/invitations",
        "post",
      ),
      "infomaniak_manage_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/invitations/{invitation_webmail}/send",
        "post",
      ),
      "infomaniak_manage_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/webmail/teams/{team_id}",
        ["patch", "delete"],
      ),
      "infomaniak_manage_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/accesses/webmail/accounts/{account_id}/users/{user_id}",
        "get",
      ),
      "infomaniak_get_mail_webmail_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/accesses/webmail/accounts/{account_id}/teams/{team_id}",
        "get",
      ),
      "infomaniak_get_mail_webmail_access",
    ],
    // Device/session cleanup
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices",
        "get",
      ),
      "infomaniak_get_mail_device_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices/users/{user_id}",
        "get",
      ),
      "infomaniak_get_mail_device_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices/{device_access}",
        "delete",
      ),
      "infomaniak_manage_mail_device_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/mailboxes/{mailbox_name}/accesses/devices/users/{user_id}",
        "delete",
      ),
      "infomaniak_manage_mail_device_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/accesses/devices/users/{user_id}",
        "get",
      ),
      "infomaniak_get_mail_device_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/{service_mail}/accesses/devices/users/{user_id}",
        "delete",
      ),
      "infomaniak_manage_mail_device_access",
    ],
    [
      pathMatches(endpoint, "/1/mail_hostings/accesses/devices", "get"),
      "infomaniak_get_mail_device_access",
    ],
    [
      pathMatches(
        endpoint,
        "/1/mail_hostings/accesses/devices/{device}",
        "delete",
      ),
      "infomaniak_manage_mail_device_access",
    ],
    // Newsletter groups and subscribers
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/groups", "get"),
      "infomaniak_get_newsletter_admin",
    ],
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/groups", "post"),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/groups/{group}", "get"),
      "infomaniak_get_newsletter_admin",
    ],
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/groups/{group}", [
        "put",
        "delete",
      ]),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/groups/{group}/subscribers",
        "get",
      ),
      "infomaniak_get_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/groups/{group}/subscribers/assign",
        "post",
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/groups/{group}/subscribers/unassign",
        "post",
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/subscribers", "get"),
      "infomaniak_get_newsletter_admin",
    ],
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/subscribers", "post"),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(endpoint, "/1/newsletters/{domain}/subscribers", "delete"),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/count_status",
        "get",
      ),
      "infomaniak_get_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/{subscriber}",
        "get",
      ),
      "infomaniak_get_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/{subscriber}",
        ["put", "delete"],
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/{subscriber}/forget",
        "delete",
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/unsubscribe",
        "put",
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/assign",
        "put",
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [
      pathMatches(
        endpoint,
        "/1/newsletters/{domain}/subscribers/unassign",
        "put",
      ),
      "infomaniak_manage_newsletter_admin",
    ],
    [endpoint.endpoint === "/2/drive/{drive_id}", "infomaniak_get_drive_full"],
    [
      endpoint.endpoint === "/3/drive/{drive_id}/files/links" &&
        endpoint.method === "get",
      "infomaniak_list_drive_share_links",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/users" &&
        endpoint.method === "get",
      "infomaniak_list_drive_file_access_users",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/teams" &&
        endpoint.method === "get",
      "infomaniak_list_drive_file_access_teams",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/invitations" &&
        endpoint.method === "get",
      "infomaniak_list_drive_file_access_invitations",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/files/{file_id}/link" &&
        endpoint.method === "get",
      "infomaniak_get_drive_share_link",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/files/{file_id}/link" &&
        endpoint.method === "post",
      "infomaniak_create_drive_share_link",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/files/{file_id}/link" &&
        endpoint.method === "put",
      "infomaniak_update_drive_share_link",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/files/{file_id}/link" &&
        endpoint.method === "delete",
      "infomaniak_remove_drive_share_link",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/files/{file_id}/link/invite" &&
        endpoint.method === "post",
      "infomaniak_invite_drive_share_link",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/settings" &&
        endpoint.method === "get",
      "infomaniak_get_drive_settings",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/settings/ai" &&
        endpoint.method === "put",
      "infomaniak_manage_drive_settings",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/settings/link" &&
        endpoint.method === "put",
      "infomaniak_manage_drive_settings",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/settings/office" &&
        endpoint.method === "put",
      "infomaniak_manage_drive_settings",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/preferences" &&
        endpoint.method === "put",
      "infomaniak_manage_drive_settings",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/users" &&
        endpoint.method === "post",
      "infomaniak_create_drive_file_access_user",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/users/{user_id}" &&
        endpoint.method === "put",
      "infomaniak_update_drive_file_access_user",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/users/{user_id}" &&
        endpoint.method === "delete",
      "infomaniak_remove_drive_file_access_user",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/teams" &&
        endpoint.method === "post",
      "infomaniak_create_drive_file_access_team",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/teams/{team_id}" &&
        endpoint.method === "put",
      "infomaniak_update_drive_file_access_team",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/teams/{team_id}" &&
        endpoint.method === "delete",
      "infomaniak_remove_drive_file_access_team",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/files/{file_id}/access/invitations" &&
        endpoint.method === "post",
      "infomaniak_create_drive_file_access_invitation",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/statistics/sizes" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/statistics/sizes/export" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/statistics/activities/users" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/statistics/activities/shared_files" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/statistics/activities" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/statistics/activities/export" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/statistics/activities/links" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint ===
        "/2/drive/{drive_id}/statistics/activities/links/export" &&
        endpoint.method === "get",
      "infomaniak_get_drive_statistics",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users" &&
        endpoint.method === "get",
      "infomaniak_list_drive_users",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users" &&
        endpoint.method === "post",
      "infomaniak_create_drive_user",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users/{user_id}" &&
        endpoint.method === "put",
      "infomaniak_update_drive_user",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users/{user_id}" &&
        endpoint.method === "delete",
      "infomaniak_delete_drive_user",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users/{user_id}/manager" &&
        endpoint.method === "patch",
      "infomaniak_set_drive_user_manager",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users/{user_id}/lock" &&
        endpoint.method === "post",
      "infomaniak_lock_drive_user",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/users/{user_id}/unlock" &&
        endpoint.method === "post",
      "infomaniak_unlock_drive_user",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/settings",
      "infomaniak_audit_kdrive_admin",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/settings/trash" &&
        endpoint.method === "put",
      "infomaniak_update_drive_trash_settings",
    ],
    [
      endpoint.endpoint === "/3/drive/{drive_id}/files/links",
      "infomaniak_audit_kdrive_admin",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/trash/count",
      "infomaniak_audit_kdrive_admin",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/trash" &&
        endpoint.method === "delete",
      "infomaniak_empty_drive_trash",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/trash/{file_id}" &&
        endpoint.method === "delete",
      "infomaniak_remove_drive_trash_item",
    ],
    [
      endpoint.endpoint === "/2/drive/{drive_id}/trash/{file_id}/restore" &&
        endpoint.method === "post",
      "infomaniak_restore_drive_trash_item",
    ],
    [
      endpoint.endpoint === "/2/zones/{zone}/records" &&
        endpoint.method === "get",
      "infomaniak_dns_list_records",
    ],
    [
      endpoint.endpoint === "/2/zones/{zone}/records" &&
        endpoint.method === "post",
      "infomaniak_dns_create_record",
    ],
    [
      endpoint.endpoint === "/2/domains/{domain}/dnssec/check",
      "infomaniak_manage_dnssec",
    ],
  ];

  // Keep coverage aligned with the public, typed tools that are implemented
  // outside the original discovery wave. This is intentionally explicit so a
  // portal route cannot silently appear covered without a matching tool.
  const extraCoverage: Array<{
    path: string;
    methods?: string | ReadonlyArray<string>;
    tool: string;
  }> = [
    { path: "/1/ai", methods: "get", tool: "infomaniak_list_ai_products" },
    { path: "/1/ai/models", methods: "get", tool: "infomaniak_list_ai_models" },
    { path: "/1/ai/{product_id}/consumptions", methods: "get", tool: "infomaniak_get_ai_consumptions" },
    { path: "/1/ai/{product_id}/results/{batch_id}", methods: "get", tool: "infomaniak_get_ai_batch_result" },
    { path: "/1/ai/{product_id}/results/{batch_id}/download", methods: "get", tool: "infomaniak_get_ai_batch_result" },
    { path: "/2/ai/{product_id}/openai/v1/models", methods: "get", tool: "infomaniak_list_ai_product_models" },
    { path: "/2/drive", methods: "get", tool: "infomaniak_list_drives" },
    { path: "/3/drive/{drive_id}/activities", methods: "get", tool: "infomaniak_get_drive_activities" },
    { path: "/3/drive/{drive_id}/files/{file_id}/activities", methods: "get", tool: "infomaniak_get_drive_file_activities" },
    { path: "/3/drive/{drive_id}/files/activities", methods: "get", tool: "infomaniak_get_drive_root_activities" },
    { path: "/2/drive/{drive_id}/activities/reports", methods: "get", tool: "infomaniak_list_drive_activity_reports" },
    { path: "/2/drive/{drive_id}/activities/reports", methods: "post", tool: "infomaniak_create_drive_activity_report" },
    { path: "/2/drive/{drive_id}/activities/reports/{report_id}", methods: "get", tool: "infomaniak_get_drive_activity_report" },
    { path: "/2/drive/{drive_id}/activities/reports/{report_id}", methods: "delete", tool: "infomaniak_delete_drive_activity_report" },
    { path: "/2/drive/{drive_id}/activities/reports/{report_id}/export", methods: "get", tool: "infomaniak_export_drive_activity_report" },
    { path: "/2/drive/{drive_id}/users/{user_id}", methods: "get", tool: "infomaniak_get_drive_user" },
    { path: "/2/drive/{drive_id}/users/invitation", methods: "get", tool: "infomaniak_list_drive_invitations" },
    { path: "/2/drive/{drive_id}/users/invitation/{invitation_id}", methods: "get", tool: "infomaniak_get_drive_invitation" },
    { path: "/2/drive/{drive_id}/settings/files/private", methods: "put", tool: "infomaniak_manage_drive_private_directory" },
    { path: "/1/mail_hostings/{service_mail}/mailboxes/{mailbox}/email_imports", methods: "get", tool: "infomaniak_list_email_imports" },
    { path: "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters/set_activation", methods: "put", tool: "infomaniak_manage_mailbox_filter_lifecycle" },
    { path: "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters/reorder", methods: "put", tool: "infomaniak_manage_mailbox_filter_lifecycle" },
    { path: "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/filters/scripts/set_activation", methods: "put", tool: "infomaniak_manage_mailbox_filter_lifecycle" },
    { path: "/1/mail_hostings/{mail_hosting_id}/mailboxes/{mailbox_name}/auth/folders/trash", methods: "delete", tool: "infomaniak_empty_mailbox_trash" },
    { path: "/1/mail_hostings/{mail_hosting_id}/mailing_lists", methods: "get", tool: "infomaniak_list_mailing_lists" },
    { path: "/1/mail_hostings/{mail_hosting_id}/auto_replies", methods: "get", tool: "infomaniak_list_service_auto_replies" },
    { path: "/1/mail_hostings/{mail_hosting_id}/preferences", methods: "get", tool: "infomaniak_get_mail_preferences" },
    { path: "/1/mail_hostings/{mail_hosting_id}/filters", methods: "get", tool: "infomaniak_list_service_filter_models" },
    { path: "/1/accounts/{account_id}", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account_id}/tags", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account_id}/products", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account_id}/services", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/current/products", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account_id}/basic/teams", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account}/teams/{team}", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account}/teams/{team}/users", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account}/invitations/{invitation}/b2b", methods: "get", tool: "infomaniak_get_account_resources" },
    { path: "/1/accounts/{account}/invitations/{invitation}/b2b", methods: "post", tool: "infomaniak_manage_account_invitation_b2b" },
    { path: "/1/accounts/{account}/invitations/{invitation}/b2b/{partnership_id}", methods: "delete", tool: "infomaniak_manage_account_invitation_b2b" },
    { path: "/2/domains/domains", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/domains/domains/{domain}", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/domains/domains/{domain}/dnssec/check", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/domains/domains/{domain}/zones", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/domains/domains/{domain}/nameservers", methods: "put", tool: "infomaniak_manage_domain_nameservers" },
    { path: "/2/zones/{zone}", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/zones/{zone}/exists", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/zones/{zone}/records/{record}", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/zones/{zone}/records/{record}/check", methods: "get", tool: "infomaniak_get_domain_resources" },
    { path: "/2/domains/{domain}/nameservers", methods: "put", tool: "infomaniak_manage_domain_nameservers" },
    { path: "/1/public_clouds", methods: "get", tool: "infomaniak_list_public_clouds" },
    { path: "/1/public_clouds/{public_cloud_id}", methods: "get", tool: "infomaniak_get_public_cloud" },
    { path: "/1/public_clouds/accesses", methods: "get", tool: "infomaniak_list_public_cloud_accesses" },
    { path: "/2/events/public-cloud-status", methods: "get", tool: "infomaniak_get_public_cloud_status" },
    { path: "/1/public_clouds/{public_cloud_id}/projects", methods: "get", tool: "infomaniak_list_public_cloud_projects" },
    { path: "/1/public_clouds/{public_cloud_id}/projects", methods: "post", tool: "infomaniak_manage_public_cloud_project" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/invite", methods: "post", tool: "infomaniak_manage_public_cloud_project" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}", methods: "get", tool: "infomaniak_get_public_cloud_project" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}", methods: ["patch", "delete"], tool: "infomaniak_manage_public_cloud_project" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/users", methods: "get", tool: "infomaniak_list_public_cloud_project_users" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/users", methods: "post", tool: "infomaniak_manage_public_cloud_project_user" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/users/{public_cloud_user_id}", methods: ["patch", "delete"], tool: "infomaniak_manage_public_cloud_project_user" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/users/invite", methods: "post", tool: "infomaniak_manage_public_cloud_project_user" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/users/{public_cloud_user_id}/invite", methods: "post", tool: "infomaniak_manage_public_cloud_project_user" },
    { path: "/1/public_clouds/dbaas", methods: "get", tool: "infomaniak_list_public_cloud_database_services" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/dbaas", methods: "get", tool: "infomaniak_list_public_cloud_database_services" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/dbaas/{dbaas_id}", methods: "get", tool: "infomaniak_get_public_cloud_database_service" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/dbaas/{dbaas_id}", methods: ["patch", "delete"], tool: "infomaniak_manage_public_cloud_database_service" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/dbaas/{dbaas_id}/reset_password", methods: "post", tool: "infomaniak_manage_public_cloud_database_service" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/dbaas/{dbaas_id}/toggle_slow_logs", methods: "post", tool: "infomaniak_manage_public_cloud_database_service" },
    { path: "/1/public_clouds/kaas", methods: "get", tool: "infomaniak_list_public_cloud_kubernetes_services" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/kaas", methods: "get", tool: "infomaniak_list_public_cloud_kubernetes_services" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/kaas/{kaas_id}", methods: "get", tool: "infomaniak_get_public_cloud_kubernetes_service" },
    { path: "/1/public_clouds/{public_cloud_id}/projects/{public_cloud_project_id}/kaas/{kaas_id}", methods: ["patch", "delete"], tool: "infomaniak_manage_public_cloud_kubernetes_service" },
    { path: "/1/public_clouds/config", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/dbaas/regions", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/dbaas/packs", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/dbaas/types", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/kaas/packs", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/kaas/versions", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/kaas/regions", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/public_clouds/kaas/availability_zones", methods: "get", tool: "infomaniak_list_public_cloud_resource_data" },
    { path: "/1/swiss_backups/{swiss_backup_id}", methods: "get", tool: "infomaniak_get_swiss_backup" },
    { path: "/1/swiss_backups/{swiss_backup_id}/acronis_informations", methods: "get", tool: "infomaniak_get_swiss_backup_acronis_info" },
    { path: "/1/swiss_backups/{swiss_backup_id}/slots", methods: "get", tool: "infomaniak_list_swiss_backup_slots" },
    { path: "/1/swiss_backups/{swiss_backup_id}/slots", methods: "post", tool: "infomaniak_manage_swiss_backup_slot" },
    { path: "/1/swiss_backups/{swiss_backup_id}/slots/{slot_id}", methods: "get", tool: "infomaniak_get_swiss_backup_slot" },
    { path: "/1/swiss_backups/{swiss_backup_id}/slots/{slot_id}", methods: ["put", "delete"], tool: "infomaniak_manage_swiss_backup_slot" },
    { path: "/1/swiss_backups/{swiss_backup_id}/slots/{slot_id}/enable", methods: "post", tool: "infomaniak_manage_swiss_backup_slot" },
    { path: "/1/swiss_backups/{swiss_backup_id}/slots/{slot_id}/disable", methods: "post", tool: "infomaniak_manage_swiss_backup_slot" },
    { path: "/1/swiss_backups/{swiss_backup_id}/admin", methods: ["post", "put"], tool: "infomaniak_manage_swiss_backup_administrator" },
    { path: "/1/swiss_backups/pricing", methods: "get", tool: "infomaniak_get_swiss_backup_pricing" },
    { path: "/1/swiss_backups/calculate", methods: "get", tool: "infomaniak_get_swiss_backup_pricing" },
  ];

  for (const mapping of extraCoverage) {
    if (pathMatches(endpoint, mapping.path, mapping.methods) && knownToolNames.has(mapping.tool)) {
      matches.push(mapping.tool);
    }
  }

  for (const [condition, toolName] of candidateMap) {
    if (condition && knownToolNames.has(toolName)) {
      matches.push(toolName);
    }
  }
  return matches;
}

function isWriteMethod(method: string): boolean {
  return (
    method === "post" ||
    method === "put" ||
    method === "patch" ||
    method === "delete"
  );
}

function isAdminRelevant(text: string): boolean {
  return [
    "account",
    "user management",
    "invitation",
    "drive",
    "mail",
    "domain",
    "zone",
    "dns",
    "hosting",
    "backup",
    "public cloud",
    "product",
    "ssl",
    "certificate",
  ].some((term) => text.includes(term));
}

function isKchatAdminRelevant(text: string): boolean {
  return [
    "kchat",
    "channel",
    "channels",
    "team",
    "teams",
    "group",
    "groups",
    "role",
    "roles",
    "bot",
    "bots",
    "command",
    "commands",
    "moderation",
    "moderations",
    "member",
    "members",
    "scheme",
    "privacy",
    "permission",
    "permissions",
  ].some((term) => text.includes(term));
}

function isKchatUserFocused(text: string): boolean {
  return [
    "post",
    "posts",
    "thread",
    "threads",
    "reaction",
    "reactions",
    "unread",
    "preference",
    "preferences",
    "emoji",
    "file",
    "files",
    "direct message",
    "group message",
    "ephemeral",
    "reminder",
    "flagged",
    "autocomplete",
    "search posts",
    "view channel",
  ].some((term) => text.includes(term));
}

function summarize(
  endpoints: ReadonlyArray<DocsEndpoint & { classification: Classification }>,
): Record<string, number> {
  const summary: Record<string, number> = {
    covered: 0,
    admin_candidate: 0,
    dangerous_write: 0,
    end_user_out_of_scope: 0,
    unknown: 0,
  };
  for (const endpoint of endpoints) {
    summary[endpoint.classification] =
      (summary[endpoint.classification] ?? 0) + 1;
  }
  return summary;
}

function renderCoverageMarkdown(
  docsUrl: string,
  summary: Record<string, number>,
  coveredExamples: ReadonlyArray<z.infer<typeof CoverageEndpointSchema>>,
  candidates: ReadonlyArray<z.infer<typeof CoverageEndpointSchema>>,
  outOfScopeExamples: ReadonlyArray<z.infer<typeof CoverageEndpointSchema>>,
): string {
  const lines = [
    `# Infomaniak API coverage`,
    ``,
    `Source: ${docsUrl}`,
    ``,
    `- Covered read endpoints: ${summary["covered"] ?? 0}`,
    `- Admin candidates: ${summary["admin_candidate"] ?? 0}`,
    `- Risky write candidates: ${summary["dangerous_write"] ?? 0}`,
    `- User-focused out of scope: ${summary["end_user_out_of_scope"] ?? 0}`,
    `- Unknown/low-priority: ${summary["unknown"] ?? 0}`,
    ``,
    `## Covered examples`,
    ``,
    ...(coveredExamples.length > 0
      ? coveredExamples
          .slice(0, 10)
          .map(
            (endpoint) =>
              `- ${endpoint.method.toUpperCase()} \`${endpoint.endpoint}\`${
                endpoint.covered_by.length > 0
                  ? ` (${endpoint.covered_by.join(", ")})`
                  : ""
              }`,
          )
      : [`- (none)`]),
    ``,
    `## Next admin candidates`,
    ``,
    ...candidates.map(
      (candidate) =>
        `- ${candidate.method.toUpperCase()} \`${candidate.endpoint}\` — ${candidate.classification}${
          candidate.covered_by.length > 0
            ? ` (${candidate.covered_by.join(", ")})`
            : ""
        }`,
    ),
  ];
  if (outOfScopeExamples.length > 0) {
    lines.push(``, `## Out of scope examples`, ``);
    lines.push(
      ...outOfScopeExamples.map(
        (endpoint) =>
          `- ${endpoint.method.toUpperCase()} \`${endpoint.endpoint}\``,
      ),
    );
  }
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
