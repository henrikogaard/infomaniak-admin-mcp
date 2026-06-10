import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool, type ToolDefinition } from "./types.js";

const MailboxSecurityInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  mailbox_name: z
    .string()
    .min(1)
    .describe(
      "Local part of the mailbox (the part before @, e.g. 'info' for info@example.com). NOT the full email address.",
    ),
});

const SenderMutationInput = MailboxSecurityInput.extend({
  sender: z
    .string()
    .trim()
    .min(1)
    .max(255)
    .regex(/^\S+$/, "sender must not contain whitespace")
    .describe("Email address or sender pattern accepted by Infomaniak."),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token returned by the prior plan response. Required on the apply phase.",
    ),
});

const SenderListDiffSchema = z.object({
  before: z.array(z.string()),
  after: z.array(z.string()),
});

const SecurityReadOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string(),
  authorized_senders: z.array(z.string()),
  blocked_senders: z.array(z.string()),
  has_move_spam: z.boolean().nullable().optional(),
  has_mail_filtering: z.boolean().nullable().optional(),
  mail_filtering_folder_commercials: z.unknown().optional(),
  mail_filtering_folder_social_networks: z.unknown().optional(),
  note: z.string().nullable().optional(),
});

const MailboxFiltersOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string(),
  prevent_script: z.boolean().optional(),
  use_scripts: z.boolean().optional(),
  scripts: z.array(z.unknown()),
  filters: z.array(z.unknown()),
  templates: z.array(z.unknown()),
  script: z.string().optional(),
});

const MailboxFilterScriptsOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string(),
  prevent_script: z.boolean().optional(),
  use_scripts: z.boolean().optional(),
  scripts: z.array(z.unknown()),
  script: z.string().optional(),
});

const MailboxSecurityFindingSchema = z.object({
  severity: z.enum(["critical", "warning", "info"]),
  category: z.string(),
  message: z.string(),
  recommendation: z.string(),
});

const MailboxSecurityAuditOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string(),
  status: z.enum(["healthy", "review_needed"]),
  summary: z.object({
    critical: z.number(),
    warning: z.number(),
    info: z.number(),
  }),
  findings: z.array(MailboxSecurityFindingSchema),
});

const SpamPolicyInput = MailboxSecurityInput.extend({
  has_move_spam: z
    .boolean()
    .optional()
    .describe("Whether spam should be moved into the spam folder."),
  has_mail_filtering: z
    .boolean()
    .optional()
    .describe("Whether Infomaniak mail filtering folders are enabled."),
  mail_filtering_folder_commercials: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe(
      "Folder used for commercial/newsletter filtering, or null to clear it.",
    ),
  mail_filtering_folder_social_networks: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Folder used for social-network filtering, or null to clear it."),
  note: z
    .string()
    .max(80)
    .nullable()
    .optional()
    .describe("Mailbox admin note, max 80 characters, or null to clear it."),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token returned by the prior plan response. Required on the apply phase.",
    ),
}).refine(
  (input) =>
    input.has_move_spam !== undefined ||
    input.has_mail_filtering !== undefined ||
    input.mail_filtering_folder_commercials !== undefined ||
    input.mail_filtering_folder_social_networks !== undefined ||
    input.note !== undefined,
  "At least one spam policy field must be provided.",
);

const HardenMailboxSecurityInput = MailboxSecurityInput.extend({
  ensure_move_spam: z
    .boolean()
    .optional()
    .describe(
      "Set has_move_spam=true when currently disabled. Defaults to true.",
    ),
  ensure_mail_filtering: z
    .boolean()
    .optional()
    .describe(
      "Set has_mail_filtering=true when currently disabled. Defaults to true.",
    ),
  mail_filtering_folder_commercials: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Optional commercials/newsletter filtering folder to set."),
  mail_filtering_folder_social_networks: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Optional social-network filtering folder to set."),
  confirmation_token: z.string().uuid().optional(),
});

const MailboxFolderMappingInput = MailboxSecurityInput.extend({
  archives_folder: z.string().min(1).describe("Folder mapped to archives."),
  draft_folder: z.string().min(1).describe("Folder mapped to drafts."),
  sent_folder: z.string().min(1).describe("Folder mapped to sent mail."),
  trash_folder: z.string().min(1).describe("Folder mapped to trash."),
  commercials_folder: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Folder for commercial/newsletter filtering, or null to clear."),
  social_networks_folder: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Folder for social-network filtering, or null to clear."),
  spam_folder: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Folder for spam-labelled mail, or null to clear when allowed."),
  confirmation_token: z.string().uuid().optional(),
});

const ConfirmOnlyInput = MailboxSecurityInput.extend({
  confirmation_token: z.string().uuid().optional(),
});

const SpamPolicyOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
    }),
    current: z.record(z.unknown()),
    updated: z.record(z.unknown()),
    diff: z.record(z.object({ before: z.unknown(), after: z.unknown() })),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    updated: z.record(z.unknown()),
    message: z.string(),
  }),
]);

const HardenMailboxSecurityOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
    }),
    audit: MailboxSecurityAuditOutput,
    updated: z.record(z.unknown()),
    diff: z.record(z.object({ before: z.unknown(), after: z.unknown() })),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    updated: z.record(z.unknown()),
    message: z.string(),
  }),
]);

const MailboxFolderMappingOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
    }),
    current_security: SecurityReadOutput,
    folder_mapping: z.record(z.string(), z.string().nullable()),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    folder_mapping: z.record(z.string(), z.string().nullable()),
    message: z.string(),
  }),
]);

const PurgeSpamFolderOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
    }),
    current_security: SecurityReadOutput,
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    message: z.string(),
  }),
]);

const FilterNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .describe("Sieve filter or script name.");

const MailboxFilterInput = MailboxSecurityInput.extend({
  name: FilterNameSchema,
  has_all_of: z
    .boolean()
    .describe(
      "Whether all filter conditions must match. False means any condition may match.",
    ),
  is_enabled: z.boolean().describe("Whether the filter is active."),
  template_id: z
    .number()
    .int()
    .positive()
    .nullable()
    .optional()
    .describe("Optional Infomaniak filter template ID, or null to clear it."),
  confirmation_token: z.string().uuid().optional(),
});

const MailboxFilterUpdateInput = MailboxFilterInput.extend({
  old_name: FilterNameSchema.describe(
    "Current filter name to update or rename.",
  ),
});

const NamedFilterDeleteInput = MailboxSecurityInput.extend({
  name: FilterNameSchema,
  confirmation_token: z.string().uuid().optional(),
});

const MailboxFilterScriptInput = MailboxSecurityInput.extend({
  old_name: FilterNameSchema.optional().describe(
    "Current script name when updating/renaming.",
  ),
  name: FilterNameSchema,
  content: z.string().min(1).describe("Full Sieve script content."),
  is_enabled: z
    .boolean()
    .optional()
    .describe("Whether the script is active. Defaults server-side."),
  confirmation_token: z.string().uuid().optional(),
});

const MailboxFilterMutationOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
      name: z.string(),
    }),
    current: MailboxFiltersOutput.omit({
      mail_hosting_id: true,
      mailbox_name: true,
    }),
    mutation: z.object({
      endpoint_kind: z.enum(["filter", "script"]),
      method: z.enum(["POST", "PATCH", "DELETE"]),
      path: z.string(),
      body: z.record(z.unknown()).optional(),
      query: z.record(z.string()).optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    name: z.string(),
    mutation: z.object({
      endpoint_kind: z.enum(["filter", "script"]),
      method: z.enum(["POST", "PATCH", "DELETE"]),
      path: z.string(),
      body: z.record(z.unknown()).optional(),
      query: z.record(z.string()).optional(),
    }),
    message: z.string(),
  }),
]);

const SenderMutationOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      mail_hosting_id: z.number(),
      mailbox_name: z.string(),
      sender: z.string(),
      action: z.enum(["block", "unblock", "authorize", "unauthorize"]),
    }),
    current: z.object({
      authorized_senders: z.array(z.string()),
      blocked_senders: z.array(z.string()),
    }),
    updated: z.record(z.array(z.string())),
    diff: z.record(SenderListDiffSchema),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string(),
    sender: z.string(),
    updated: z.record(z.array(z.string())),
    message: z.string(),
  }),
]);

type SenderAction = "block" | "unblock" | "authorize" | "unauthorize";
type SenderField = "authorized_senders" | "blocked_senders";
type SenderLists = Record<SenderField, string[]>;
type SenderPatch = Partial<Record<SenderField, string[]>>;
type PolicyField =
  | "has_move_spam"
  | "has_mail_filtering"
  | "mail_filtering_folder_commercials"
  | "mail_filtering_folder_social_networks"
  | "note";
type PolicyPatch = Partial<Record<PolicyField, unknown>>;
type PolicyDiff = Record<string, { before: unknown; after: unknown }>;
type FilterEndpointKind = "filter" | "script";
type FilterMutationMethod = "POST" | "PATCH" | "DELETE";
type MailboxFilterInventory = Omit<
  z.infer<typeof MailboxFiltersOutput>,
  "mail_hosting_id" | "mailbox_name"
>;
type MailboxSecurityFinding = z.infer<typeof MailboxSecurityFindingSchema>;
type MailboxSecurityAudit = z.infer<typeof MailboxSecurityAuditOutput>;

interface MailboxSecurityAuditCurrent {
  snapshot: MailboxSecuritySnapshot;
  filters: MailboxFilterInventory;
  audit: MailboxSecurityAudit;
}

interface FilterMutation {
  endpoint_kind: FilterEndpointKind;
  method: FilterMutationMethod;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
}

interface MailboxSecuritySnapshot extends SenderLists {
  mailbox_name: string;
  has_move_spam?: boolean | null;
  has_mail_filtering?: boolean | null;
  mail_filtering_folder_commercials?: unknown;
  mail_filtering_folder_social_networks?: unknown;
  note?: string | null;
}

interface SenderMutationSpec {
  toolName: string;
  action: SenderAction;
  title: string;
  applyLabel: string;
  messageVerb: string;
  mutate: (current: SenderLists, sender: string) => SenderLists;
  undoTool: string;
}

export const getMailboxSecurityTool = defineTool({
  name: "infomaniak_get_mailbox_security",
  description:
    "Read mailbox security and spam-control state: authorized senders, blocked senders, spam move policy, mail filtering folders, and note.",
  inputSchema: MailboxSecurityInput,
  outputSchema: SecurityReadOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const snapshot = await fetchMailboxSecurity(
      input.mail_hosting_id,
      input.mailbox_name,
    );
    return buildSecurityOutput(input.mail_hosting_id, snapshot);
  },
});

export const listMailboxFiltersTool = defineTool({
  name: "infomaniak_list_mailbox_filters",
  description:
    "List Sieve filters, scripts, and available templates for a mailbox. Read-only admin inventory for spam/filter policy auditing.",
  inputSchema: MailboxSecurityInput,
  outputSchema: MailboxFiltersOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const data = await fetchMailboxFilters(
      input.mail_hosting_id,
      input.mailbox_name,
    );
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      ...(typeof data["prevent_script"] === "boolean"
        ? { prevent_script: data["prevent_script"] }
        : {}),
      ...(typeof data["use_scripts"] === "boolean"
        ? { use_scripts: data["use_scripts"] }
        : {}),
      scripts: Array.isArray(data["scripts"]) ? data["scripts"] : [],
      filters: Array.isArray(data["filters"]) ? data["filters"] : [],
      templates: Array.isArray(data["templates"]) ? data["templates"] : [],
      ...(typeof data["script"] === "string" ? { script: data["script"] } : {}),
    };
  },
});

export const listMailboxFilterScriptsTool = defineTool({
  name: "infomaniak_list_mailbox_filter_scripts",
  description:
    "List only the advanced Sieve scripts configured on a mailbox. Focused read-only view derived from the mailbox filter inventory endpoint.",
  inputSchema: MailboxSecurityInput,
  outputSchema: MailboxFilterScriptsOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const inventory = await readMailboxFilterInventory(
      input.mail_hosting_id,
      input.mailbox_name,
    );
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      ...(inventory.prevent_script !== undefined
        ? { prevent_script: inventory.prevent_script }
        : {}),
      ...(inventory.use_scripts !== undefined
        ? { use_scripts: inventory.use_scripts }
        : {}),
      scripts: inventory.scripts,
      ...(inventory.script !== undefined ? { script: inventory.script } : {}),
    };
  },
});

export const auditMailboxSecurityTool = defineTool({
  name: "infomaniak_audit_mailbox_security",
  description:
    "Read-only admin audit for a mailbox security posture: spam policy, sender conflicts, Sieve scripts, and disabled filters.",
  inputSchema: MailboxSecurityInput,
  outputSchema: MailboxSecurityAuditOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const current = await loadMailboxSecurityAuditCurrent(
      input.mail_hosting_id,
      input.mailbox_name,
    );
    return current.audit;
  },
});

export const setMailboxSpamPolicyTool = defineTool({
  name: "infomaniak_set_mailbox_spam_policy",
  description:
    "Update mailbox spam movement, smart filtering folders, and admin note. Two-phase commit: returns a current-state diff and confirmation token, then applies only if the policy state has not changed.",
  inputSchema: SpamPolicyInput,
  outputSchema: SpamPolicyOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: createMutationGuardedHandler<
    z.infer<typeof SpamPolicyInput>,
    MailboxSecuritySnapshot,
    {
      plan: { mail_hosting_id: number; mailbox_name: string };
      current: Record<PolicyField, unknown>;
      updated: PolicyPatch;
      diff: PolicyDiff;
    },
    {
      mail_hosting_id: number;
      mailbox_name: string;
      updated: PolicyPatch;
      message: string;
    }
  >({
    toolName: "infomaniak_set_mailbox_spam_policy",
    loadCurrent: async (input) =>
      fetchMailboxSecurity(input.mail_hosting_id, input.mailbox_name),
    buildPlan: (input, snapshot) => {
      const current = policyStateFromSnapshot(snapshot);
      const { updated, diff } = buildPolicyPatchAndDiff(input, current);
      return {
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
        },
        current,
        updated,
        diff,
      };
    },
    fingerprintPayload: (input, _snapshot, plan) => ({
      tool: "infomaniak_set_mailbox_spam_policy",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      current: plan.current,
      updated: plan.updated,
    }),
    apply: async (input, plan) => {
      if (Object.keys(plan.updated).length > 0) {
        await patchMailboxSecurity(
          input.mail_hosting_id,
          input.mailbox_name,
          plan.updated,
        );
      }

      recordHistory({
        tool: "infomaniak_set_mailbox_spam_policy",
        kind: "update_mailbox_security",
        summary: `Updated spam policy for ${input.mailbox_name} (${input.mail_hosting_id})`,
        payload: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          updated: plan.updated,
        },
      });

      return {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        updated: plan.updated,
        message: `✅ Mailbox spam policy updated for \`${input.mailbox_name}\`.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderSpamPolicyPlanMarkdown(input, plan.diff, token),
  }),
});

export const updateMailboxFoldersTool = defineTool({
  name: "infomaniak_update_mailbox_folders",
  description:
    "Update mailbox folder mappings for archives, drafts, sent, trash, spam, commercials, and social-network folders. Two-phase commit with mailbox security state guard.",
  inputSchema: MailboxFolderMappingInput,
  outputSchema: MailboxFolderMappingOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: createMutationGuardedHandler<
    z.infer<typeof MailboxFolderMappingInput>,
    MailboxSecuritySnapshot,
    {
      plan: { mail_hosting_id: number; mailbox_name: string };
      current_security: z.infer<typeof SecurityReadOutput>;
      folder_mapping: Record<string, string | null>;
    },
    {
      mail_hosting_id: number;
      mailbox_name: string;
      folder_mapping: Record<string, string | null>;
      message: string;
    }
  >({
    toolName: "infomaniak_update_mailbox_folders",
    loadCurrent: async (input) =>
      fetchMailboxSecurity(input.mail_hosting_id, input.mailbox_name),
    buildPlan: (input, snapshot) => ({
      plan: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
      },
      current_security: buildSecurityOutput(input.mail_hosting_id, snapshot),
      folder_mapping: buildFolderMapping(input),
    }),
    fingerprintPayload: (input, snapshot, plan) => ({
      tool: "infomaniak_update_mailbox_folders",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      current_security: buildSecurityOutput(input.mail_hosting_id, snapshot),
      folder_mapping: plan.folder_mapping,
    }),
    apply: async (input, plan) => {
      await putMailboxFolders(
        input.mail_hosting_id,
        input.mailbox_name,
        plan.folder_mapping,
      );
      recordHistory({
        tool: "infomaniak_update_mailbox_folders",
        kind: "update_mailbox_security",
        summary: `Updated folder mappings for ${input.mailbox_name} (${input.mail_hosting_id})`,
        payload: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          folder_mapping: plan.folder_mapping,
        },
      });
      return {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        folder_mapping: plan.folder_mapping,
        message: `✅ Mailbox folder mappings updated for \`${input.mailbox_name}\`.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderMailboxFoldersPlanMarkdown(input, plan.folder_mapping, token),
  }),
});

export const purgeSpamFolderTool = defineTool({
  name: "infomaniak_purge_spam_folder",
  description:
    "Delete all messages currently in a mailbox spam folder. Destructive two-phase commit with mailbox security state guard.",
  inputSchema: ConfirmOnlyInput,
  outputSchema: PurgeSpamFolderOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: {
    scope: "admin",
    risk: "destructive",
    confirmationRequired: true,
  },
  handler: createMutationGuardedHandler<
    z.infer<typeof ConfirmOnlyInput>,
    MailboxSecuritySnapshot,
    {
      plan: { mail_hosting_id: number; mailbox_name: string };
      current_security: z.infer<typeof SecurityReadOutput>;
    },
    {
      mail_hosting_id: number;
      mailbox_name: string;
      message: string;
    }
  >({
    toolName: "infomaniak_purge_spam_folder",
    loadCurrent: async (input) =>
      fetchMailboxSecurity(input.mail_hosting_id, input.mailbox_name),
    buildPlan: (input, snapshot) => ({
      plan: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
      },
      current_security: buildSecurityOutput(input.mail_hosting_id, snapshot),
    }),
    fingerprintPayload: (input, snapshot) => ({
      tool: "infomaniak_purge_spam_folder",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      current_security: buildSecurityOutput(input.mail_hosting_id, snapshot),
    }),
    apply: async (input) => {
      await deleteMailboxSpamFolder(input.mail_hosting_id, input.mailbox_name);
      recordHistory({
        tool: "infomaniak_purge_spam_folder",
        kind: "update_mailbox_security",
        summary: `Purged spam folder for ${input.mailbox_name} (${input.mail_hosting_id})`,
        payload: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
        },
      });
      return {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        message: `✅ Spam folder purged for \`${input.mailbox_name}\`.`,
      };
    },
    renderPlanMarkdown: (input, _plan, token) =>
      renderPurgeSpamFolderPlanMarkdown(input, token),
  }),
});

export const hardenMailboxSecurityTool = defineTool({
  name: "infomaniak_harden_mailbox_security",
  description:
    "Plan and apply conservative mailbox security hardening: enable spam movement, enable mail filtering, and optionally set filtering folders. Two-phase commit with audit/current-state guard.",
  inputSchema: HardenMailboxSecurityInput,
  outputSchema: HardenMailboxSecurityOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: createMutationGuardedHandler<
    z.infer<typeof HardenMailboxSecurityInput>,
    MailboxSecurityAuditCurrent,
    {
      plan: { mail_hosting_id: number; mailbox_name: string };
      audit: MailboxSecurityAudit;
      updated: PolicyPatch;
      diff: PolicyDiff;
    },
    {
      mail_hosting_id: number;
      mailbox_name: string;
      updated: PolicyPatch;
      message: string;
    }
  >({
    toolName: "infomaniak_harden_mailbox_security",
    loadCurrent: async (input) =>
      loadMailboxSecurityAuditCurrent(
        input.mail_hosting_id,
        input.mailbox_name,
      ),
    buildPlan: (input, current) => {
      const policyState = policyStateFromSnapshot(current.snapshot);
      const desired = buildHardenedPolicy(input, policyState);
      const diff = diffPolicyPatch(policyState, desired);
      return {
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
        },
        audit: current.audit,
        updated: desired,
        diff,
      };
    },
    fingerprintPayload: (input, current, plan) => ({
      tool: "infomaniak_harden_mailbox_security",
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      audit: current.audit,
      filters: current.filters,
      updated: plan.updated,
    }),
    apply: async (input, plan) => {
      if (Object.keys(plan.updated).length > 0) {
        await patchMailboxSecurity(
          input.mail_hosting_id,
          input.mailbox_name,
          plan.updated,
        );
      }
      recordHistory({
        tool: "infomaniak_harden_mailbox_security",
        kind: "update_mailbox_security",
        summary: `Hardened mailbox security for ${input.mailbox_name} (${input.mail_hosting_id})`,
        payload: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          updated: plan.updated,
        },
      });
      return {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        updated: plan.updated,
        message: `✅ Mailbox security hardening applied for \`${input.mailbox_name}\`.`,
      };
    },
    renderPlanMarkdown: (input, plan, token) =>
      renderHardenMailboxSecurityPlanMarkdown(input, plan, token),
  }),
});

export const createMailboxFilterTool = defineMailboxFilterMutationTool({
  name: "infomaniak_create_mailbox_filter",
  description:
    "Create a mailbox Sieve filter. Two-phase commit: first call returns current filter inventory and confirmation token, second call applies the POST if inventory is unchanged.",
  inputSchema: MailboxFilterInput,
  buildMutation: (input) => ({
    endpoint_kind: "filter",
    method: "POST",
    path: mailboxFiltersPath(input.mail_hosting_id, input.mailbox_name),
    body: {
      name: input.name,
      has_all_of: input.has_all_of,
      is_enabled: input.is_enabled,
      ...(input.template_id !== undefined
        ? { template_id: input.template_id }
        : {}),
    },
  }),
});

export const updateMailboxFilterTool = defineMailboxFilterMutationTool({
  name: "infomaniak_update_mailbox_filter",
  description:
    "Update or rename a mailbox Sieve filter. Two-phase commit with current filter inventory guard before PATCH.",
  inputSchema: MailboxFilterUpdateInput,
  buildMutation: (input) => ({
    endpoint_kind: "filter",
    method: "PATCH",
    path: mailboxFiltersPath(input.mail_hosting_id, input.mailbox_name),
    body: {
      old_name: input.old_name,
      name: input.name,
      has_all_of: input.has_all_of,
      is_enabled: input.is_enabled,
      ...(input.template_id !== undefined
        ? { template_id: input.template_id }
        : {}),
    },
  }),
});

export const deleteMailboxFilterTool = defineMailboxFilterMutationTool({
  name: "infomaniak_delete_mailbox_filter",
  description:
    "Delete a mailbox Sieve filter by name. Two-phase commit with current filter inventory guard before DELETE.",
  inputSchema: NamedFilterDeleteInput,
  buildMutation: (input) => ({
    endpoint_kind: "filter",
    method: "DELETE",
    path: mailboxFiltersPath(input.mail_hosting_id, input.mailbox_name),
    query: { name: input.name },
  }),
});

export const upsertMailboxFilterScriptTool = defineMailboxFilterMutationTool({
  name: "infomaniak_upsert_mailbox_filter_script",
  description:
    "Create or update a mailbox Sieve script. Omit old_name to create; provide old_name to update/rename. Two-phase commit with current inventory guard.",
  inputSchema: MailboxFilterScriptInput,
  buildMutation: (input) => ({
    endpoint_kind: "script",
    method: input.old_name ? "PATCH" : "POST",
    path: mailboxFilterScriptsPath(input.mail_hosting_id, input.mailbox_name),
    body: {
      ...(input.old_name ? { old_name: input.old_name } : {}),
      name: input.name,
      content: input.content,
      ...(input.is_enabled !== undefined
        ? { is_enabled: input.is_enabled }
        : {}),
    },
  }),
});

export const deleteMailboxFilterScriptTool = defineMailboxFilterMutationTool({
  name: "infomaniak_delete_mailbox_filter_script",
  description:
    "Delete a mailbox Sieve script by name. Two-phase commit with current filter/script inventory guard before DELETE.",
  inputSchema: NamedFilterDeleteInput,
  buildMutation: (input) => ({
    endpoint_kind: "script",
    method: "DELETE",
    path: mailboxFilterScriptsPath(input.mail_hosting_id, input.mailbox_name),
    query: { name: input.name },
  }),
});

function defineMailboxFilterMutationTool<
  TInput extends z.ZodTypeAny,
>(definition: {
  name: string;
  description: string;
  inputSchema: TInput;
  buildMutation: (input: z.infer<TInput>) => FilterMutation;
}): ToolDefinition {
  type ParsedInput = z.infer<TInput> & {
    mail_hosting_id: number;
    mailbox_name: string;
    name: string;
    confirmation_token?: string;
  };

  return defineTool({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: MailboxFilterMutationOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: definition.name.includes("delete"),
      openWorldHint: true,
    },
    handler: createMutationGuardedHandler<
      ParsedInput,
      MailboxFilterInventory,
      {
        plan: { mail_hosting_id: number; mailbox_name: string; name: string };
        current: MailboxFilterInventory;
        mutation: FilterMutation;
      },
      {
        mail_hosting_id: number;
        mailbox_name: string;
        name: string;
        mutation: FilterMutation;
        message: string;
      }
    >({
      toolName: definition.name,
      loadCurrent: async (input) =>
        readMailboxFilterInventory(input.mail_hosting_id, input.mailbox_name),
      buildPlan: (input, current) => ({
        plan: {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          name: input.name,
        },
        current,
        mutation: definition.buildMutation(input),
      }),
      fingerprintPayload: (input, _current, plan) => ({
        tool: definition.name,
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        name: input.name,
        current: plan.current,
        mutation: plan.mutation,
      }),
      apply: async (input, plan) => {
        await applyMailboxFilterMutation(plan.mutation);
        recordHistory({
          tool: definition.name,
          kind: "update_mailbox_security",
          summary: `${plan.mutation.method} mailbox ${plan.mutation.endpoint_kind} ${input.name} on ${input.mailbox_name} (${input.mail_hosting_id})`,
          payload: {
            mail_hosting_id: input.mail_hosting_id,
            mailbox_name: input.mailbox_name,
            name: input.name,
            mutation: plan.mutation,
          },
        });

        return {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          name: input.name,
          mutation: plan.mutation,
          message: `✅ Mailbox ${plan.mutation.endpoint_kind} \`${input.name}\` ${plan.mutation.method.toLowerCase()} applied.`,
        };
      },
      renderPlanMarkdown: (input, plan, token) =>
        renderMailboxFilterMutationPlanMarkdown(
          definition.name,
          input,
          plan.mutation,
          token,
        ),
    }),
  });
}

export const blockSenderTool = defineSenderMutationTool({
  toolName: "infomaniak_block_sender",
  action: "block",
  title: "block sender",
  applyLabel: "Block this sender",
  messageVerb: "blocked",
  undoTool: "infomaniak_unblock_sender",
  mutate: (current, sender) => ({
    authorized_senders: removeSender(current.authorized_senders, sender),
    blocked_senders: addSender(current.blocked_senders, sender),
  }),
});

export const unblockSenderTool = defineSenderMutationTool({
  toolName: "infomaniak_unblock_sender",
  action: "unblock",
  title: "unblock sender",
  applyLabel: "Unblock this sender",
  messageVerb: "unblocked",
  undoTool: "infomaniak_block_sender",
  mutate: (current, sender) => ({
    authorized_senders: current.authorized_senders,
    blocked_senders: removeSender(current.blocked_senders, sender),
  }),
});

export const authorizeSenderTool = defineSenderMutationTool({
  toolName: "infomaniak_authorize_sender",
  action: "authorize",
  title: "authorize sender",
  applyLabel: "Authorize this sender",
  messageVerb: "authorized",
  undoTool: "infomaniak_unauthorize_sender",
  mutate: (current, sender) => ({
    authorized_senders: addSender(current.authorized_senders, sender),
    blocked_senders: removeSender(current.blocked_senders, sender),
  }),
});

export const unauthorizeSenderTool = defineSenderMutationTool({
  toolName: "infomaniak_unauthorize_sender",
  action: "unauthorize",
  title: "remove authorized sender",
  applyLabel: "Remove this authorized sender",
  messageVerb: "removed from authorized senders",
  undoTool: "infomaniak_authorize_sender",
  mutate: (current, sender) => ({
    authorized_senders: removeSender(current.authorized_senders, sender),
    blocked_senders: current.blocked_senders,
  }),
});

function defineSenderMutationTool(spec: SenderMutationSpec): ToolDefinition {
  return defineTool({
    name: spec.toolName,
    description: `${spec.applyLabel}. Two-phase commit: first call returns the current-state diff and confirmation token, second call with the token applies the PATCH if the mailbox sender lists have not changed.`,
    inputSchema: SenderMutationInput,
    outputSchema: SenderMutationOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
    handler: createMutationGuardedHandler<
      z.infer<typeof SenderMutationInput>,
      SenderLists,
      {
        plan: {
          mail_hosting_id: number;
          mailbox_name: string;
          sender: string;
          action: SenderAction;
        };
        current: SenderLists;
        updated: SenderPatch;
        diff: Record<SenderField, { before: string[]; after: string[] }>;
      },
      {
        mail_hosting_id: number;
        mailbox_name: string;
        sender: string;
        updated: SenderPatch;
        message: string;
      }
    >({
      toolName: spec.toolName,
      loadCurrent: async (input) =>
        senderListsFromSnapshot(
          await fetchMailboxSecurity(input.mail_hosting_id, input.mailbox_name),
        ),
      buildPlan: (input, current) => {
        const sender = normalizeSender(input.sender);
        const desired = spec.mutate(current, sender);
        const updated = buildPatch(current, desired);
        const diff = buildDiff(current, desired);
        return {
          plan: {
            mail_hosting_id: input.mail_hosting_id,
            mailbox_name: input.mailbox_name,
            sender,
            action: spec.action,
          },
          current,
          updated,
          diff,
        };
      },
      fingerprintPayload: (input, _current, plan) => ({
        tool: spec.toolName,
        action: spec.action,
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        sender: plan.plan.sender,
        current: plan.current,
        updated: plan.updated,
      }),
      apply: async (input, plan) => {
        if (Object.keys(plan.updated).length > 0) {
          await patchMailboxSecurity(
            input.mail_hosting_id,
            input.mailbox_name,
            plan.updated,
          );
        }

        recordHistory({
          tool: spec.toolName,
          kind: "update_mailbox_security",
          summary: `${spec.applyLabel} ${plan.plan.sender} on ${input.mailbox_name} (${input.mail_hosting_id})`,
          payload: {
            mail_hosting_id: input.mail_hosting_id,
            mailbox_name: input.mailbox_name,
            sender: plan.plan.sender,
            updated: plan.updated,
          },
          undo: {
            tool: spec.undoTool,
            params: {
              mail_hosting_id: input.mail_hosting_id,
              mailbox_name: input.mailbox_name,
              sender: plan.plan.sender,
            },
            description: `Undo: ${spec.undoTool} for ${plan.plan.sender}`,
          },
        });

        return {
          mail_hosting_id: input.mail_hosting_id,
          mailbox_name: input.mailbox_name,
          sender: plan.plan.sender,
          updated: plan.updated,
          message: `✅ Sender \`${plan.plan.sender}\` ${spec.messageVerb}.`,
        };
      },
      renderPlanMarkdown: (input, plan, token) =>
        renderSenderPlanMarkdown(
          spec,
          input,
          plan.plan.sender,
          plan.diff,
          token,
        ),
    }),
  });
}

async function fetchMailboxSecurity(
  mailHostingId: number,
  mailboxName: string,
): Promise<MailboxSecuritySnapshot> {
  const client = new PublicApiClient();
  const data = await client.request<Record<string, unknown>>(
    "GET",
    mailboxSecurityPath(mailHostingId, mailboxName),
  );
  return parseMailboxSecurity(data, mailboxName);
}

async function fetchMailboxFilters(
  mailHostingId: number,
  mailboxName: string,
): Promise<Record<string, unknown>> {
  const client = new PublicApiClient();
  return await client.request<Record<string, unknown>>(
    "GET",
    mailboxFiltersPath(mailHostingId, mailboxName),
  );
}

async function readMailboxFilterInventory(
  mailHostingId: number,
  mailboxName: string,
): Promise<MailboxFilterInventory> {
  const data = await fetchMailboxFilters(mailHostingId, mailboxName);
  return {
    ...(typeof data["prevent_script"] === "boolean"
      ? { prevent_script: data["prevent_script"] }
      : {}),
    ...(typeof data["use_scripts"] === "boolean"
      ? { use_scripts: data["use_scripts"] }
      : {}),
    scripts: Array.isArray(data["scripts"]) ? data["scripts"] : [],
    filters: Array.isArray(data["filters"]) ? data["filters"] : [],
    templates: Array.isArray(data["templates"]) ? data["templates"] : [],
    ...(typeof data["script"] === "string" ? { script: data["script"] } : {}),
  };
}

async function loadMailboxSecurityAuditCurrent(
  mailHostingId: number,
  mailboxName: string,
): Promise<MailboxSecurityAuditCurrent> {
  const [snapshot, filters] = await Promise.all([
    fetchMailboxSecurity(mailHostingId, mailboxName),
    readMailboxFilterInventory(mailHostingId, mailboxName),
  ]);
  return {
    snapshot,
    filters,
    audit: buildMailboxSecurityAudit(
      mailHostingId,
      mailboxName,
      snapshot,
      filters,
    ),
  };
}

async function applyMailboxFilterMutation(
  mutation: FilterMutation,
): Promise<void> {
  const client = new PublicApiClient();
  await client.request<unknown>(mutation.method, mutation.path, {
    ...(mutation.query ? { query: mutation.query } : {}),
    ...(mutation.body ? { body: mutation.body } : {}),
  });
}

async function patchMailboxSecurity(
  mailHostingId: number,
  mailboxName: string,
  patch: SenderPatch | PolicyPatch,
): Promise<void> {
  const client = new PublicApiClient();
  await client.request<unknown>(
    "PATCH",
    mailboxSecurityPath(mailHostingId, mailboxName),
    {
      body: patch,
    },
  );
}

async function putMailboxFolders(
  mailHostingId: number,
  mailboxName: string,
  folderMapping: Record<string, string | null>,
): Promise<void> {
  const client = new PublicApiClient();
  await client.request<unknown>(
    "PUT",
    mailboxFoldersPath(mailHostingId, mailboxName),
    {
      body: folderMapping,
    },
  );
}

async function deleteMailboxSpamFolder(
  mailHostingId: number,
  mailboxName: string,
): Promise<void> {
  const client = new PublicApiClient();
  await client.request<unknown>(
    "DELETE",
    mailboxSpamFolderPath(mailHostingId, mailboxName),
  );
}

function mailboxSecurityPath(
  mailHostingId: number,
  mailboxName: string,
): string {
  return `/1/mail_hostings/${mailHostingId}/mailboxes/${encodeURIComponent(mailboxName)}`;
}

function mailboxFiltersPath(
  mailHostingId: number,
  mailboxName: string,
): string {
  return `${mailboxSecurityPath(mailHostingId, mailboxName)}/auth/filters`;
}

function mailboxFilterScriptsPath(
  mailHostingId: number,
  mailboxName: string,
): string {
  return `${mailboxFiltersPath(mailHostingId, mailboxName)}/scripts`;
}

function mailboxFoldersPath(
  mailHostingId: number,
  mailboxName: string,
): string {
  return `${mailboxSecurityPath(mailHostingId, mailboxName)}/auth/folders`;
}

function mailboxSpamFolderPath(
  mailHostingId: number,
  mailboxName: string,
): string {
  return `${mailboxFoldersPath(mailHostingId, mailboxName)}/spam`;
}

function parseMailboxSecurity(
  data: Record<string, unknown>,
  fallbackMailboxName: string,
): MailboxSecuritySnapshot {
  const result: MailboxSecuritySnapshot = {
    mailbox_name:
      typeof data["mailbox_name"] === "string"
        ? data["mailbox_name"]
        : fallbackMailboxName,
    authorized_senders: normalizeSenderList(data["authorized_senders"]),
    blocked_senders: normalizeSenderList(data["blocked_senders"]),
  };

  if (
    typeof data["has_move_spam"] === "boolean" ||
    data["has_move_spam"] === null
  ) {
    result.has_move_spam = data["has_move_spam"];
  }
  if (
    typeof data["has_mail_filtering"] === "boolean" ||
    data["has_mail_filtering"] === null
  ) {
    result.has_mail_filtering = data["has_mail_filtering"];
  }
  if ("mail_filtering_folder_commercials" in data) {
    result.mail_filtering_folder_commercials =
      data["mail_filtering_folder_commercials"];
  }
  if ("mail_filtering_folder_social_networks" in data) {
    result.mail_filtering_folder_social_networks =
      data["mail_filtering_folder_social_networks"];
  }
  if (typeof data["note"] === "string" || data["note"] === null) {
    result.note = data["note"];
  }

  return result;
}

function buildSecurityOutput(
  mailHostingId: number,
  snapshot: MailboxSecuritySnapshot,
): z.infer<typeof SecurityReadOutput> {
  return {
    mail_hosting_id: mailHostingId,
    mailbox_name: snapshot.mailbox_name,
    authorized_senders: snapshot.authorized_senders,
    blocked_senders: snapshot.blocked_senders,
    ...(snapshot.has_move_spam !== undefined
      ? { has_move_spam: snapshot.has_move_spam }
      : {}),
    ...(snapshot.has_mail_filtering !== undefined
      ? { has_mail_filtering: snapshot.has_mail_filtering }
      : {}),
    ...(snapshot.mail_filtering_folder_commercials !== undefined
      ? {
          mail_filtering_folder_commercials:
            snapshot.mail_filtering_folder_commercials,
        }
      : {}),
    ...(snapshot.mail_filtering_folder_social_networks !== undefined
      ? {
          mail_filtering_folder_social_networks:
            snapshot.mail_filtering_folder_social_networks,
        }
      : {}),
    ...(snapshot.note !== undefined ? { note: snapshot.note } : {}),
  };
}

function senderListsFromSnapshot(
  snapshot: MailboxSecuritySnapshot,
): SenderLists {
  return {
    authorized_senders: snapshot.authorized_senders,
    blocked_senders: snapshot.blocked_senders,
  };
}

function policyStateFromSnapshot(
  snapshot: MailboxSecuritySnapshot,
): Record<PolicyField, unknown> {
  return {
    has_move_spam: snapshot.has_move_spam,
    has_mail_filtering: snapshot.has_mail_filtering,
    mail_filtering_folder_commercials:
      snapshot.mail_filtering_folder_commercials,
    mail_filtering_folder_social_networks:
      snapshot.mail_filtering_folder_social_networks,
    note: snapshot.note,
  };
}

function buildMailboxSecurityAudit(
  mailHostingId: number,
  mailboxName: string,
  snapshot: MailboxSecuritySnapshot,
  filters: MailboxFilterInventory,
): MailboxSecurityAudit {
  const findings: MailboxSecurityFinding[] = [];

  if (snapshot.has_move_spam !== true) {
    findings.push({
      severity: "warning",
      category: "spam_policy",
      message: "Spam is not configured to move into the spam folder.",
      recommendation: "Enable has_move_spam for this mailbox.",
    });
  }

  if (snapshot.has_mail_filtering !== true) {
    findings.push({
      severity: "warning",
      category: "mail_filtering",
      message: "Infomaniak mail filtering folders are disabled.",
      recommendation:
        "Enable has_mail_filtering when mailbox sorting is expected.",
    });
  }

  const conflicts = snapshot.authorized_senders.filter((sender) =>
    snapshot.blocked_senders.includes(sender),
  );
  for (const sender of conflicts) {
    findings.push({
      severity: "warning",
      category: "sender_conflict",
      message: `Sender ${sender} appears in both authorized and blocked senders.`,
      recommendation:
        "Remove the sender from one list so policy is unambiguous.",
    });
  }

  for (const script of filters.scripts) {
    if (isEnabledRecord(script)) {
      findings.push({
        severity: "info",
        category: "custom_sieve_script",
        message: `Enabled Sieve script ${recordName(script)} should be reviewed periodically.`,
        recommendation:
          "Confirm the script is still owned and intended by an admin.",
      });
    }
  }

  for (const filter of filters.filters) {
    if (isDisabledRecord(filter)) {
      findings.push({
        severity: "info",
        category: "disabled_filter",
        message: `Disabled filter ${recordName(filter)} is present.`,
        recommendation:
          "Delete stale filters or re-enable them if still needed.",
      });
    }
  }

  const summary = countFindings(findings);
  return {
    mail_hosting_id: mailHostingId,
    mailbox_name: mailboxName,
    status:
      summary.critical > 0 || summary.warning > 0 ? "review_needed" : "healthy",
    summary,
    findings,
  };
}

function buildHardenedPolicy(
  input: z.infer<typeof HardenMailboxSecurityInput>,
  current: Record<PolicyField, unknown>,
): PolicyPatch {
  const requested: PolicyPatch = {};
  if (input.ensure_move_spam !== false) {
    requested.has_move_spam = true;
  }
  if (input.ensure_mail_filtering !== false) {
    requested.has_mail_filtering = true;
  }
  if (input.mail_filtering_folder_commercials !== undefined) {
    requested.mail_filtering_folder_commercials =
      input.mail_filtering_folder_commercials;
  }
  if (input.mail_filtering_folder_social_networks !== undefined) {
    requested.mail_filtering_folder_social_networks =
      input.mail_filtering_folder_social_networks;
  }
  return diffOnlyPolicyPatch(current, requested);
}

function buildFolderMapping(
  input: z.infer<typeof MailboxFolderMappingInput>,
): Record<string, string | null> {
  return {
    archives_folder: input.archives_folder,
    draft_folder: input.draft_folder,
    sent_folder: input.sent_folder,
    trash_folder: input.trash_folder,
    ...(input.commercials_folder !== undefined
      ? { commercials_folder: input.commercials_folder }
      : {}),
    ...(input.social_networks_folder !== undefined
      ? { social_networks_folder: input.social_networks_folder }
      : {}),
    ...(input.spam_folder !== undefined
      ? { spam_folder: input.spam_folder }
      : {}),
  };
}

function diffOnlyPolicyPatch(
  current: Record<PolicyField, unknown>,
  requested: PolicyPatch,
): PolicyPatch {
  const updated: PolicyPatch = {};
  for (const field of policyFields()) {
    if (
      field in requested &&
      !samePolicyValue(current[field], requested[field])
    ) {
      updated[field] = requested[field];
    }
  }
  return updated;
}

function diffPolicyPatch(
  current: Record<PolicyField, unknown>,
  updated: PolicyPatch,
): PolicyDiff {
  const diff: PolicyDiff = {};
  for (const field of policyFields()) {
    if (field in updated) {
      diff[field] = {
        before: current[field],
        after: updated[field],
      };
    }
  }
  return diff;
}

function countFindings(
  findings: ReadonlyArray<MailboxSecurityFinding>,
): MailboxSecurityAudit["summary"] {
  return {
    critical: findings.filter((finding) => finding.severity === "critical")
      .length,
    warning: findings.filter((finding) => finding.severity === "warning")
      .length,
    info: findings.filter((finding) => finding.severity === "info").length,
  };
}

function isEnabledRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { is_enabled?: unknown }).is_enabled === true
  );
}

function isDisabledRecord(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { is_enabled?: unknown }).is_enabled === false
  );
}

function recordName(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string"
  ) {
    return `\`${(value as { name: string }).name}\``;
  }
  return "`(unnamed)`";
}

function buildPolicyPatchAndDiff(
  input: z.infer<typeof SpamPolicyInput>,
  current: Record<PolicyField, unknown>,
): { updated: PolicyPatch; diff: PolicyDiff } {
  const updated: PolicyPatch = {};
  const diff: PolicyDiff = {};

  for (const field of policyFields()) {
    const requested = input[field];
    if (
      requested !== undefined &&
      !samePolicyValue(current[field], requested)
    ) {
      updated[field] = requested;
      diff[field] = {
        before: current[field],
        after: requested,
      };
    }
  }

  return { updated, diff };
}

function samePolicyValue(current: unknown, requested: unknown): boolean {
  return current === requested;
}

function normalizeSenderList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    const sender = normalizeSender(String(item));
    if (sender.length > 0 && !result.includes(sender)) {
      result.push(sender);
    }
  }
  return result;
}

function normalizeSender(sender: string): string {
  return sender.trim().toLowerCase();
}

function addSender(list: string[], sender: string): string[] {
  return list.includes(sender) ? list : [...list, sender];
}

function removeSender(list: string[], sender: string): string[] {
  return list.filter((item) => item !== sender);
}

function buildPatch(current: SenderLists, desired: SenderLists): SenderPatch {
  const patch: SenderPatch = {};
  for (const field of senderFields()) {
    if (!sameList(current[field], desired[field])) {
      patch[field] = desired[field];
    }
  }
  return patch;
}

function buildDiff(
  current: SenderLists,
  desired: SenderLists,
): Record<SenderField, { before: string[]; after: string[] }> {
  const diff: Partial<
    Record<SenderField, { before: string[]; after: string[] }>
  > = {};
  for (const field of senderFields()) {
    if (!sameList(current[field], desired[field])) {
      diff[field] = {
        before: current[field],
        after: desired[field],
      };
    }
  }
  return diff as Record<SenderField, { before: string[]; after: string[] }>;
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function senderFields(): SenderField[] {
  return ["authorized_senders", "blocked_senders"];
}

function policyFields(): PolicyField[] {
  return [
    "has_move_spam",
    "has_mail_filtering",
    "mail_filtering_folder_commercials",
    "mail_filtering_folder_social_networks",
    "note",
  ];
}

function renderSenderPlanMarkdown(
  spec: SenderMutationSpec,
  input: z.infer<typeof SenderMutationInput>,
  sender: string,
  diff: Record<SenderField, { before: string[]; after: string[] }>,
  token: string,
): string {
  const lines = [
    `## Plan — ${spec.title}`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: \`${input.mailbox_name}@…\``,
    `- **Sender**: \`${sender}\``,
    ``,
    `### Sender-list diff`,
  ];

  if (Object.keys(diff).length === 0) {
    lines.push(
      `No mailbox sender-list changes are needed; the mailbox already has this state.`,
    );
  } else {
    for (const field of senderFields()) {
      const change = diff[field];
      if (change) {
        lines.push(
          `- **${field}**: \`${change.before.join(", ") || "(empty)"}\` → \`${change.after.join(", ") || "(empty)"}\``,
        );
      }
    }
  }

  lines.push(
    ``,
    `### Next step`,
    `Re-call \`${spec.toolName}\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  );

  return lines.join("\n");
}

function renderMailboxFilterMutationPlanMarkdown(
  toolName: string,
  input: {
    mail_hosting_id: number;
    mailbox_name: string;
    name: string;
  },
  mutation: FilterMutation,
  token: string,
): string {
  return [
    `## Plan — ${mutation.method.toLowerCase()} mailbox ${mutation.endpoint_kind}`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: \`${input.mailbox_name}@…\``,
    `- **${mutation.endpoint_kind}**: \`${input.name}\``,
    `- **Endpoint**: \`${mutation.method} ${mutation.path}\``,
    ...(mutation.query
      ? [`- **Query**: \`${JSON.stringify(mutation.query)}\``]
      : []),
    ...(mutation.body
      ? [`- **Body**: \`${JSON.stringify(mutation.body)}\``]
      : []),
    ``,
    `### Current-state guard`,
    `The current Sieve filter/script inventory was prefetched and is part of the confirmation token. Re-plan if another admin changes filters before apply.`,
    ``,
    `### Next step`,
    `Re-call \`${toolName}\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderHardenMailboxSecurityPlanMarkdown(
  input: z.infer<typeof HardenMailboxSecurityInput>,
  plan: {
    audit: MailboxSecurityAudit;
    updated: PolicyPatch;
    diff: PolicyDiff;
  },
  token: string,
): string {
  const lines = [
    `## Plan — harden mailbox security`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: \`${input.mailbox_name}@…\``,
    `- **Audit status**: ${plan.audit.status}`,
    `- **Findings**: ${plan.audit.summary.critical} critical, ${plan.audit.summary.warning} warning, ${plan.audit.summary.info} info`,
    ``,
    `### Policy changes`,
  ];

  if (Object.keys(plan.diff).length === 0) {
    lines.push(
      `No mailbox policy changes are needed; the configured hardening target is already met.`,
    );
  } else {
    for (const field of policyFields()) {
      const change = plan.diff[field];
      if (change) {
        lines.push(
          `- **${field}**: \`${String(change.before)}\` → \`${String(change.after)}\``,
        );
      }
    }
  }

  lines.push(
    ``,
    `### Next step`,
    `Re-call \`infomaniak_harden_mailbox_security\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  );

  return lines.join("\n");
}

function renderMailboxFoldersPlanMarkdown(
  input: z.infer<typeof MailboxFolderMappingInput>,
  folderMapping: Record<string, string | null>,
  token: string,
): string {
  return [
    `## Plan — update mailbox folder mappings`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: \`${input.mailbox_name}@…\``,
    `- **Endpoint**: \`PUT ${mailboxFoldersPath(input.mail_hosting_id, input.mailbox_name)}\``,
    ``,
    `### Folder mapping`,
    ...Object.entries(folderMapping).map(
      ([field, value]) => `- **${field}**: \`${value ?? "(cleared)"}\``,
    ),
    ``,
    `### Current-state guard`,
    `The mailbox security state was prefetched and is part of the confirmation token. Re-plan if another admin changes mailbox policy before apply.`,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_update_mailbox_folders\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderPurgeSpamFolderPlanMarkdown(
  input: z.infer<typeof ConfirmOnlyInput>,
  token: string,
): string {
  return [
    `## Plan — purge spam folder`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: \`${input.mailbox_name}@…\``,
    `- **Endpoint**: \`DELETE ${mailboxSpamFolderPath(input.mail_hosting_id, input.mailbox_name)}\``,
    ``,
    `### Impact`,
    `This deletes all messages currently in the mailbox spam folder. The MCP cannot undo this operation.`,
    ``,
    `### Current-state guard`,
    `The mailbox security state was prefetched and is part of the confirmation token. Re-plan if another admin changes mailbox policy before apply.`,
    ``,
    `### Next step`,
    `Re-call \`infomaniak_purge_spam_folder\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}

function renderSpamPolicyPlanMarkdown(
  input: z.infer<typeof SpamPolicyInput>,
  diff: PolicyDiff,
  token: string,
): string {
  const lines = [
    `## Plan — update mailbox spam policy`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Mailbox**: \`${input.mailbox_name}@…\``,
    ``,
    `### Policy diff`,
  ];

  if (Object.keys(diff).length === 0) {
    lines.push(
      `No policy changes are needed; the mailbox already has this state.`,
    );
  } else {
    for (const field of policyFields()) {
      const change = diff[field];
      if (change) {
        lines.push(
          `- **${field}**: \`${String(change.before)}\` → \`${String(change.after)}\``,
        );
      }
    }
  }

  lines.push(
    ``,
    `### Next step`,
    `Re-call \`infomaniak_set_mailbox_spam_policy\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
  );

  return lines.join("\n");
}
