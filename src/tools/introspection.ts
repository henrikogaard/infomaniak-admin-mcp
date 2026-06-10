import { z } from "zod";

import { capabilitySortWeight, getToolCapability } from "./capabilities.js";
import { defineTool } from "./types.js";

import { tools } from "./index.js";

// help: fuzzy intent to tool suggestions

const CapabilitySchema = z.object({
  scope: z.enum(["admin", "end_user", "mixed"]),
  risk: z.enum(["read", "write", "destructive"]),
  confirmation_required: z.boolean(),
});

const HelpInput = z.object({
  intent: z
    .string()
    .min(2)
    .describe("Free-form description of what you want to do, in any language."),
  limit: z.number().int().min(1).max(20).default(5),
});

const SuggestionSchema = z.object({
  tool: z.string(),
  description: z.string(),
  score: z.number(),
  matched_terms: z.array(z.string()),
  capability: CapabilitySchema.optional(),
});

const HelpOutput = z.object({
  intent: z.string(),
  suggestions: z.array(SuggestionSchema),
  next_step_markdown: z.string(),
});

export const helpTool = defineTool({
  name: "infomaniak_help",
  description:
    "Suggest which Infomaniak tools to use for a given intent expressed in natural language. Lightweight keyword matching against tool names and descriptions.",
  inputSchema: HelpInput,
  outputSchema: HelpOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input) => {
    const terms = tokenize(input.intent);
    const suggestions: Array<
      z.infer<typeof SuggestionSchema> & {
        capability: ReturnType<typeof getToolCapability>;
      }
    > = [];
    for (const tool of tools) {
      const haystackTokens = new Set([
        ...tokenize(tool.name),
        ...tokenize(tool.description),
      ]);
      const matched = terms.filter((t) => haystackTokens.has(t));
      if (matched.length > 0) {
        const capability = getToolCapability(tool);
        suggestions.push({
          tool: tool.name,
          description: tool.description,
          score: matched.length,
          matched_terms: matched,
          capability,
        });
      }
    }
    suggestions.sort(
      (a, b) =>
        b.score - a.score ||
        capabilitySortWeight(b.capability) -
          capabilitySortWeight(a.capability) ||
        a.tool.localeCompare(b.tool),
    );
    const top = suggestions.slice(0, input.limit);
    const md = top.length
      ? [
          `## Suggested tools for "${input.intent}"`,
          ``,
          ...top.map(
            (s) =>
              `- **\`${s.tool}\`** (${s.score} term match, ${s.capability.scope}/${s.capability.risk}): ${s.description}`,
          ),
          ``,
          `Use \`infomaniak_explain\` with a tool name to learn its parameters.`,
        ].join("\n")
      : [
          `## No direct matches for "${input.intent}"`,
          ``,
          `Try a more specific term — for example: "create site", "list mailboxes",`,
          `"DNS record", "domain expiration", "audit my account".`,
        ].join("\n");

    return { intent: input.intent, suggestions: top, next_step_markdown: md };
  },
});

// tool_catalog: browse the MCP toolbox by category/capability

const ToolCategorySchema = z.enum([
  "introspection",
  "audit_logging",
  "account_access",
  "mail_security",
  "mail",
  "dns",
  "domain",
  "kdrive",
  "hosting",
  "database",
  "ssl",
  "identity",
  "workflow",
  "ai",
  "backup",
  "url_shortener",
  "kchat",
  "escape_hatch",
  "other",
]);

const ToolCatalogInput = z.object({
  category: ToolCategorySchema.optional().describe("Optional category filter."),
  scope: z.enum(["admin", "end_user", "mixed"]).optional(),
  risk: z.enum(["read", "write", "destructive"]).optional(),
  limit: z.number().int().min(1).max(500).default(200),
  include_descriptions: z.boolean().default(true),
});

const ToolCatalogEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  capability: CapabilitySchema,
});

const ToolCategoryOutputSchema = z.object({
  category: ToolCategorySchema,
  label: z.string(),
  count: z.number(),
  tools: z.array(ToolCatalogEntrySchema),
});

const UseCaseSchema = z.object({
  title: z.string(),
  prompt: z.string(),
  tools: z.array(z.string()),
  categories: z.array(ToolCategorySchema),
});

const ToolCatalogOutput = z.object({
  tool_count: z.number(),
  filters: z.object({
    category: ToolCategorySchema.optional(),
    scope: z.enum(["admin", "end_user", "mixed"]).optional(),
    risk: z.enum(["read", "write", "destructive"]).optional(),
  }),
  categories: z.array(ToolCategoryOutputSchema),
  high_value_use_cases: z.array(UseCaseSchema),
  summary_markdown: z.string(),
});

export const toolCatalogTool = defineTool({
  name: "infomaniak_tool_catalog",
  description:
    "List the MCP's Infomaniak tools by admin category, risk, and capability. Best for asking 'what can this MCP do?' before choosing a specific workflow.",
  inputSchema: ToolCatalogInput,
  outputSchema: ToolCatalogOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const limit = input.limit ?? 200;
    const includeDescriptions = input.include_descriptions ?? true;
    const entries = tools
      .map((tool) => ({
        category: categoryForTool(tool.name),
        tool: {
          name: tool.name,
          ...(includeDescriptions ? { description: tool.description } : {}),
          capability: getToolCapability(tool),
        },
      }))
      .filter((entry) => !input.category || entry.category === input.category)
      .filter(
        (entry) => !input.scope || entry.tool.capability.scope === input.scope,
      )
      .filter(
        (entry) => !input.risk || entry.tool.capability.risk === input.risk,
      )
      .slice(0, limit);

    const categories = buildCategoryGroups(entries);
    const useCases = HIGH_VALUE_USE_CASES.filter(
      (useCase) =>
        !input.category || useCase.categories.includes(input.category),
    );

    return {
      tool_count: entries.length,
      filters: {
        ...(input.category ? { category: input.category } : {}),
        ...(input.scope ? { scope: input.scope } : {}),
        ...(input.risk ? { risk: input.risk } : {}),
      },
      categories,
      high_value_use_cases: useCases,
      summary_markdown: renderToolCatalogMarkdown(categories, useCases),
    };
  },
});

// explain: describe one tool in detail

const ExplainInput = z.object({
  tool: z
    .string()
    .min(1)
    .describe("Name of the tool to explain (e.g. 'infomaniak_overview')."),
});

const ExplainOutput = z.object({
  tool: z.string(),
  description: z.string(),
  annotations: z.record(z.boolean()).optional(),
  capability: CapabilitySchema,
  input_schema: z.record(z.unknown()),
  output_schema: z.record(z.unknown()).optional(),
});

export const explainTool = defineTool({
  name: "infomaniak_explain",
  description:
    "Returns the full definition of a specific tool — description, annotations, input parameters and output shape.",
  inputSchema: ExplainInput,
  outputSchema: ExplainOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async (input) => {
    const tool = tools.find((t) => t.name === input.tool);
    if (!tool) {
      const known = tools.map((t) => `\`${t.name}\``).join(", ");
      throw new Error(
        `Unknown tool: ${input.tool}. Known tools: ${known}. Use infomaniak_help for fuzzy lookup.`,
      );
    }
    // Import only when a tool needs schema expansion.
    const { zodToJsonSchema } = await import("zod-to-json-schema");
    const inputSchema = zodToJsonSchema(tool.inputSchema, {
      target: "openApi3",
    }) as Record<string, unknown>;
    const annotations = tool.annotations
      ? Object.fromEntries(
          Object.entries(tool.annotations).filter(
            (entry): entry is [string, boolean] =>
              typeof entry[1] === "boolean",
          ),
        )
      : undefined;
    const result: z.infer<typeof ExplainOutput> = {
      tool: tool.name,
      description: tool.description,
      capability: getToolCapability(tool),
      input_schema: inputSchema,
      ...(annotations !== undefined ? { annotations } : {}),
    };
    if (tool.outputSchema) {
      result.output_schema = zodToJsonSchema(tool.outputSchema, {
        target: "openApi3",
      }) as Record<string, unknown>;
    }
    return result;
  },
});

type ToolCategory = z.infer<typeof ToolCategorySchema>;

const CATEGORY_LABELS: Record<ToolCategory, string> = {
  introspection: "Introspection and discovery",
  audit_logging: "Audit logging",
  account_access: "Account access and offboarding",
  mail_security: "Mail security and spam control",
  mail: "Mail administration",
  dns: "DNS and DNSSEC",
  domain: "Domain administration",
  kdrive: "kDrive administration",
  hosting: "Web hosting and FTP/SSH",
  database: "Databases",
  ssl: "SSL certificates",
  identity: "Identity and profile",
  workflow: "Multi-step workflows",
  ai: "AI products",
  backup: "Swiss Backup",
  url_shortener: "URL shortener",
  kchat: "kChat governance",
  escape_hatch: "Escape hatch",
  other: "Other",
};

const HIGH_VALUE_USE_CASES: Array<z.infer<typeof UseCaseSchema>> = [
  {
    title: "Block spam senders",
    prompt:
      "Block spam@example.net from info@example.com and show me the diff before applying.",
    tools: [
      "infomaniak_get_mailbox_security",
      "infomaniak_block_sender",
      "infomaniak_unblock_sender",
    ],
    categories: ["mail_security"],
  },
  {
    title: "Harden mailbox security",
    prompt:
      "Audit and harden info@example.com against spam, but show me what changes first.",
    tools: [
      "infomaniak_audit_mailbox_security",
      "infomaniak_harden_mailbox_security",
      "infomaniak_list_mailbox_filters",
    ],
    categories: ["mail_security"],
  },
  {
    title: "Offboard an account user safely",
    prompt: "Prepare offboarding for user 7890 on account 123456.",
    tools: [
      "infomaniak_audit_account_access",
      "infomaniak_plan_user_offboarding",
      "infomaniak_cancel_user_pending_invitations",
    ],
    categories: ["account_access"],
  },
  {
    title: "Manage account invitations and teams",
    prompt:
      "Create an account invitation, patch it if the access plan changes, and update team membership without guessing the endpoint shape.",
    tools: [
      "infomaniak_create_account_invitation",
      "infomaniak_update_account_invitation",
      "infomaniak_delete_account_invitation",
      "infomaniak_create_account_team",
      "infomaniak_update_account_team",
      "infomaniak_delete_account_team",
      "infomaniak_add_account_team_users",
      "infomaniak_remove_account_team_users",
    ],
    categories: ["account_access"],
  },
  {
    title: "Grant product access through an invitation",
    prompt:
      "Show an invitation snapshot, then grant or revoke kSuite, drive, mailbox, or kChat access on that invitation with confirmation.",
    tools: [
      "infomaniak_get_account_invitation_access",
      "infomaniak_manage_account_invitation_access",
    ],
    categories: ["account_access"],
  },
  {
    title: "Manage account tags",
    prompt: "Create, update, or delete account tags as part of org hygiene.",
    tools: [
      "infomaniak_create_account_tag",
      "infomaniak_update_account_tag",
      "infomaniak_delete_account_tag",
    ],
    categories: ["account_access"],
  },
  {
    title: "Review what the MCP changed",
    prompt: "Show me applied or destructive MCP actions from today.",
    tools: ["infomaniak_audit_log_tail", "infomaniak_audit_log_search"],
    categories: ["audit_logging"],
  },
  {
    title: "Audit domain DNS posture",
    prompt:
      "Audit example.com for DNSSEC, MX, SPF, DMARC, wildcard records, and low TTLs.",
    tools: ["infomaniak_audit_domain_dns_admin", "infomaniak_dns_list_records"],
    categories: ["dns", "domain"],
  },
  {
    title: "Audit kDrive admin exposure",
    prompt: "Audit kDrive 44311 for risky share links and external users.",
    tools: [
      "infomaniak_audit_kdrive_admin",
      "infomaniak_list_drive_users",
      "infomaniak_list_drive_share_links",
    ],
    categories: ["kdrive"],
  },
  {
    title: "Clean up risky kDrive share links",
    prompt:
      "List risky kDrive share links and remove or tighten the ones without expiry.",
    tools: [
      "infomaniak_list_drive_share_links",
      "infomaniak_get_drive_share_link",
      "infomaniak_update_drive_share_link",
      "infomaniak_remove_drive_share_link",
    ],
    categories: ["kdrive"],
  },
  {
    title: "Adjust mailbox forwarding and auto-replies",
    prompt:
      "Replace forwarding addresses, add a forwarding target, or reset the mailbox auto-reply model with a confirmation step.",
    tools: [
      "infomaniak_manage_mailbox_forwarding",
      "infomaniak_manage_mailbox_auto_reply",
      "infomaniak_manage_mailbox_aliases",
    ],
    categories: ["mail"],
  },
  {
    title: "Control mail service redirections",
    prompt:
      "List service redirections, resend confirmations, or add/remove a target without touching end-user chat features.",
    tools: [
      "infomaniak_manage_service_redirections",
      "infomaniak_rotate_mail_dkim",
    ],
    categories: ["mail"],
  },
  {
    title: "Manage mail signatures and templates",
    prompt:
      "List mailbox or service signature templates, then create, update, or delete them with confirmation.",
    tools: [
      "infomaniak_get_mail_signatures",
      "infomaniak_manage_mail_signatures",
    ],
    categories: ["mail"],
  },
  {
    title: "Review webmail access",
    prompt:
      "Show who can access a mailbox in webmail, then add or revoke user access with confirmation.",
    tools: [
      "infomaniak_get_mail_webmail_access",
      "infomaniak_manage_mail_webmail_access",
    ],
    categories: ["mail"],
  },
  {
    title: "Clean up mail device sessions",
    prompt:
      "List mailbox device sessions for a user and revoke suspicious devices with a confirmation step.",
    tools: [
      "infomaniak_get_mail_device_access",
      "infomaniak_manage_mail_device_access",
    ],
    categories: ["mail"],
  },
  {
    title: "Manage newsletter groups and subscribers",
    prompt:
      "List newsletter groups and subscribers, then create, update, assign, or delete them with confirmation.",
    tools: [
      "infomaniak_get_newsletter_admin",
      "infomaniak_manage_newsletter_admin",
    ],
    categories: ["mail"],
  },
  {
    title: "Govern kChat channels",
    prompt:
      "List kChat channels, inspect moderation and permissions, then update channels, members, bots, commands, or groups with confirmation.",
    tools: [
      "infomaniak_list_kchat_channels",
      "infomaniak_list_kchat_team_channels",
      "infomaniak_get_kchat_channel",
      "infomaniak_list_kchat_channel_members",
      "infomaniak_get_kchat_channel_moderation",
      "infomaniak_list_kchat_groups",
      "infomaniak_list_kchat_bots",
      "infomaniak_get_kchat_bot",
      "infomaniak_list_kchat_commands",
      "infomaniak_get_kchat_command",
      "infomaniak_manage_kchat_channel",
      "infomaniak_manage_kchat_channel_members",
      "infomaniak_manage_kchat_bot",
      "infomaniak_manage_kchat_command",
    ],
    categories: ["kchat"],
  },
  {
    title: "Review kDrive activity",
    prompt:
      "Show storage, user activity, shared-file activity, and share-link activity for kDrive 44311.",
    tools: ["infomaniak_get_drive_statistics", "infomaniak_audit_kdrive_admin"],
    categories: ["kdrive"],
  },
  {
    title: "Manage kDrive users safely",
    prompt:
      "Add, update, lock, unlock, or remove a kDrive user, but show me the plan first.",
    tools: [
      "infomaniak_list_drive_users",
      "infomaniak_create_drive_user",
      "infomaniak_update_drive_user",
      "infomaniak_lock_drive_user",
      "infomaniak_delete_drive_user",
    ],
    categories: ["kdrive"],
  },
  {
    title: "Tune kDrive settings",
    prompt:
      "Read the current kDrive settings snapshot, then update AI, share-link, office, or preferences settings with confirmation.",
    tools: [
      "infomaniak_get_drive_settings",
      "infomaniak_manage_drive_settings",
    ],
    categories: ["kdrive"],
  },
  {
    title: "Manage kDrive file permissions safely",
    prompt:
      "Review current file access on a kDrive document, then grant, update, or revoke user and team permissions with a confirmation step.",
    tools: [
      "infomaniak_list_drive_file_access_users",
      "infomaniak_list_drive_file_access_teams",
      "infomaniak_list_drive_file_access_invitations",
      "infomaniak_create_drive_file_access_user",
      "infomaniak_update_drive_file_access_user",
      "infomaniak_remove_drive_file_access_user",
      "infomaniak_create_drive_file_access_team",
      "infomaniak_update_drive_file_access_team",
      "infomaniak_remove_drive_file_access_team",
      "infomaniak_create_drive_file_access_invitation",
    ],
    categories: ["kdrive"],
  },
];

function buildCategoryGroups(
  entries: ReadonlyArray<{
    category: ToolCategory;
    tool: z.infer<typeof ToolCatalogEntrySchema>;
  }>,
): Array<z.infer<typeof ToolCategoryOutputSchema>> {
  const groups = new Map<
    ToolCategory,
    Array<z.infer<typeof ToolCatalogEntrySchema>>
  >();
  for (const entry of entries) {
    const group = groups.get(entry.category) ?? [];
    group.push(entry.tool);
    groups.set(entry.category, group);
  }
  return [...groups.entries()].map(([category, categoryTools]) => ({
    category,
    label: CATEGORY_LABELS[category],
    count: categoryTools.length,
    tools: categoryTools.sort((a, b) => a.name.localeCompare(b.name)),
  }));
}

function categoryForTool(name: string): ToolCategory {
  if (
    name.includes("tool_catalog") ||
    name.includes("help") ||
    name.includes("explain")
  ) {
    return "introspection";
  }
  if (
    name.includes("audit_log") ||
    name.includes("history") ||
    name.includes("undo")
  ) {
    return "audit_logging";
  }
  if (
    name.includes("account_access") ||
    name.includes("account_user") ||
    name.includes("account_team") ||
    name.includes("account_tag") ||
    name.includes("account_invitation") ||
    name.includes("app_access") ||
    name.includes("offboarding") ||
    (name.includes("invitation") && !name.includes("drive"))
  ) {
    return "account_access";
  }
  if (
    name.includes("mailbox_security") ||
    name.includes("sender") ||
    name.includes("spam_policy") ||
    name.includes("spam_folder") ||
    name.includes("mailbox_filter") ||
    name.includes("mailbox_folder") ||
    name.includes("harden_mailbox")
  ) {
    return "mail_security";
  }
  if (
    name.includes("mail") ||
    name.includes("redirection") ||
    name.includes("forwarding") ||
    name.includes("auto_reply") ||
    name.includes("signature") ||
    name.includes("mailing_list") ||
    name.includes("webmail") ||
    name.includes("device") ||
    name.includes("newsletter") ||
    name.includes("subscriber") ||
    name.includes("dkim") ||
    (name.includes("mailbox") && name.includes("alias"))
  ) {
    return "mail";
  }
  if (name.includes("dns") || name.includes("zone")) {
    return "dns";
  }
  if (name.includes("domain")) {
    return "domain";
  }
  if (name.includes("drive")) {
    return "kdrive";
  }
  if (name.includes("kchat")) {
    return "kchat";
  }
  if (
    name.includes("hosting") ||
    name.includes("site") ||
    name.includes("nodejs") ||
    name.includes("ftp")
  ) {
    return "hosting";
  }
  if (name.includes("database")) {
    return "database";
  }
  if (name.includes("certificate") || name.includes("ssl")) {
    return "ssl";
  }
  if (name.includes("profile") || name.includes("security")) {
    return "identity";
  }
  if (
    name.includes("provision") ||
    name.includes("overview") ||
    name.includes("audit_account")
  ) {
    return "workflow";
  }
  if (name.includes("ai")) {
    return "ai";
  }
  if (name.includes("swiss_backup")) {
    return "backup";
  }
  if (name.includes("short_url")) {
    return "url_shortener";
  }
  if (name.includes("api_call")) {
    return "escape_hatch";
  }
  return "other";
}

function renderToolCatalogMarkdown(
  categories: ReadonlyArray<z.infer<typeof ToolCategoryOutputSchema>>,
  useCases: ReadonlyArray<z.infer<typeof UseCaseSchema>>,
): string {
  const lines = [
    "# Infomaniak MCP tool catalog",
    "",
    "Use `infomaniak_help` for intent search and `infomaniak_explain` for one tool's schemas.",
    "",
    "## High-value admin prompts",
    "",
    ...useCases.map((useCase) => `- ${useCase.title}: "${useCase.prompt}"`),
    "",
    "## Tools by category",
    "",
  ];

  for (const category of categories) {
    lines.push(`### ${category.label} (${category.count})`);
    for (const tool of category.tools) {
      lines.push(
        `- \`${tool.name}\` (${tool.capability.scope}/${tool.capability.risk}${
          tool.capability.confirmation_required ? ", confirmation" : ""
        })${tool.description ? `: ${tool.description}` : ""}`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function tokenize(input: string): string[] {
  const matches = input.toLowerCase().match(/[a-z0-9]+/g);
  if (!matches) {
    return [];
  }
  return [...new Set(matches.filter((token) => token.length > 1))];
}
