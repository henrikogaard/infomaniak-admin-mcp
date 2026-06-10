import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const MailHostingInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
});

const MailboxInput = MailHostingInput.extend({
  mailbox_name: z
    .string()
    .min(1)
    .describe(
      "Local part of the mailbox (for example `info` for info@example.com).",
    ),
});

const MailboxAliasInput = MailboxInput.extend({
  action: z.enum(["list", "replace", "add", "delete"]),
  alias: z
    .string()
    .min(1)
    .optional()
    .describe("Alias local part to add or delete."),
  aliases: z
    .array(z.string().min(1))
    .optional()
    .describe("Full alias list to replace with."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe(
      "Raw request body to send when the endpoint expects a richer payload.",
    ),
  confirmation_token: z.string().uuid().optional(),
});

const MailboxForwardingInput = MailboxInput.extend({
  action: z.enum(["list", "replace", "add", "delete", "delete_all"]),
  forwarding_address: z
    .string()
    .min(1)
    .optional()
    .describe("Single forwarding address to remove."),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body accepted by the forwarding endpoints."),
  confirmation_token: z.string().uuid().optional(),
});

const MailboxAutoReplyInput = MailboxInput.extend({
  action: z.enum(["list", "create", "update", "delete", "reset"]),
  model_id: z.number().int().positive().optional(),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body accepted by the auto-reply endpoints."),
  confirmation_token: z.string().uuid().optional(),
});

const RedirectionInput = MailHostingInput.extend({
  action: z.enum([
    "list",
    "create",
    "update",
    "delete",
    "enable",
    "list_targets",
    "add_target",
    "remove_target",
    "resend_confirmation",
    "resend_target_confirmation",
  ]),
  redirection_id: z.number().int().positive().optional(),
  target_id: z.number().int().positive().optional(),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body accepted by the redirection endpoints."),
  target: z
    .string()
    .optional()
    .describe("Target address or identifier when removing a target."),
  confirmation_token: z.string().uuid().optional(),
});

const DkimInput = MailHostingInput.extend({
  action: z.enum(["check", "rotate"]),
  confirmation_token: z.string().uuid().optional(),
});

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
      .object({
        status: z.literal("applied"),
        result: z.unknown().optional(),
        message: z.string(),
      })
      .passthrough(),
  ])
  .describe("Two-phase confirmation result.");

export const manageMailboxAliasesTool = defineMailMutationTool({
  name: "infomaniak_manage_mailbox_aliases",
  description:
    "List, replace, add, or delete mailbox aliases. Replace/add/delete paths use two-phase confirmation and refetch the current alias list before applying.",
  inputSchema: MailboxAliasInput,
  loadCurrent: async (input) =>
    readMailboxAliases(input.mail_hosting_id, input.mailbox_name),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    mailbox_name: input.mailbox_name,
    action: input.action,
    current_aliases: current,
    ...(input.alias !== undefined ? { alias: input.alias } : {}),
    ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const base = `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(
      input.mailbox_name,
    )}/aliases`;
    let result: unknown;
    if (input.action === "replace") {
      result = await client.request<unknown>("PUT", base, {
        body: input.payload ?? { aliases: input.aliases ?? [] },
      });
    } else if (input.action === "add") {
      result = await client.request<unknown>("POST", base, {
        body: input.payload ?? (input.alias ? { alias: input.alias } : {}),
      });
    } else if (input.action === "delete") {
      if (!input.alias) {
        throw new Error("alias is required when action=delete");
      }
      result = await client.request<unknown>(
        "DELETE",
        `${base}/${encodeURIComponent(input.alias)}`,
      );
    } else {
      result = await client.request<unknown>("GET", base);
    }
    recordHistory({
      tool: "infomaniak_manage_mailbox_aliases",
      kind: "mail_admin",
      summary: `Mailbox aliases ${input.action} on ${input.mailbox_name}@${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        action: input.action,
        ...(input.alias !== undefined ? { alias: input.alias } : {}),
        ...(input.aliases !== undefined ? { aliases: input.aliases } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      action: input.action,
      result,
      message: `✅ Mailbox aliases ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "manage mailbox aliases",
      input.mail_hosting_id,
      plan,
      token,
    ),
});

export const manageMailboxForwardingTool = defineMailMutationTool({
  name: "infomaniak_manage_mailbox_forwarding",
  description:
    "List, replace, add, or delete mailbox forwarding addresses. Uses the forwarding-address collection endpoint and two-phase confirmation for mutations.",
  inputSchema: MailboxForwardingInput,
  loadCurrent: async (input) =>
    readMailboxForwarding(input.mail_hosting_id, input.mailbox_name),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    mailbox_name: input.mailbox_name,
    action: input.action,
    current_forwarding: current,
    ...(input.forwarding_address !== undefined
      ? { forwarding_address: input.forwarding_address }
      : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const base = `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(
      input.mailbox_name,
    )}/forwarding_addresses`;
    let result: unknown;
    if (input.action === "replace") {
      result = await client.request<unknown>("PUT", base, {
        body: input.payload ?? {},
      });
    } else if (input.action === "add") {
      result = await client.request<unknown>("POST", base, {
        body: input.payload ?? {},
      });
    } else if (input.action === "delete_all") {
      result = await client.request<unknown>("DELETE", base);
    } else if (input.action === "delete") {
      if (!input.forwarding_address) {
        throw new Error("forwarding_address is required when action=delete");
      }
      result = await client.request<unknown>(
        "DELETE",
        `${base}/${encodeURIComponent(input.forwarding_address)}`,
      );
    } else {
      result = await client.request<unknown>("GET", base);
    }
    recordHistory({
      tool: "infomaniak_manage_mailbox_forwarding",
      kind: "mail_admin",
      summary: `Mailbox forwarding ${input.action} on ${input.mailbox_name}@${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        action: input.action,
        ...(input.forwarding_address !== undefined
          ? { forwarding_address: input.forwarding_address }
          : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      action: input.action,
      result,
      message: `✅ Mailbox forwarding ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "manage mailbox forwarding",
      input.mail_hosting_id,
      plan,
      token,
    ),
});

export const manageMailboxAutoReplyTool = defineMailMutationTool({
  name: "infomaniak_manage_mailbox_auto_reply",
  description:
    "List, create, update, delete, or reset mailbox auto-reply models. Uses the mailbox auto-reply model endpoints and two-phase confirmation for mutations.",
  inputSchema: MailboxAutoReplyInput,
  loadCurrent: async (input) =>
    readMailboxAutoReplyModels(input.mail_hosting_id, input.mailbox_name),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    mailbox_name: input.mailbox_name,
    action: input.action,
    current_auto_reply: current,
    ...(input.model_id !== undefined ? { model_id: input.model_id } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const base = `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(
      input.mailbox_name,
    )}/auto_reply`;
    let result: unknown;
    if (input.action === "list") {
      result = await client.request<unknown>("GET", `${base}/model`);
    } else if (input.action === "create") {
      result = await client.request<unknown>("POST", `${base}/model`, {
        body: input.payload ?? {},
      });
    } else if (input.action === "reset") {
      result = await client.request<unknown>("PUT", `${base}/reset`);
    } else if (input.action === "delete") {
      if (!input.model_id) {
        throw new Error("model_id is required when action=delete");
      }
      result = await client.request<unknown>(
        "DELETE",
        `${base}/model/${input.model_id}`,
      );
    } else {
      if (!input.model_id) {
        throw new Error("model_id is required when action=update");
      }
      result = await client.request<unknown>(
        "PATCH",
        `${base}/model/${input.model_id}`,
        {
          body: input.payload ?? {},
        },
      );
    }
    recordHistory({
      tool: "infomaniak_manage_mailbox_auto_reply",
      kind: "mail_admin",
      summary: `Mailbox auto-reply ${input.action} on ${input.mailbox_name}@${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        action: input.action,
        ...(input.model_id !== undefined ? { model_id: input.model_id } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      mailbox_name: input.mailbox_name,
      action: input.action,
      result,
      message: `✅ Mailbox auto-reply ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "manage mailbox auto-reply",
      input.mail_hosting_id,
      plan,
      token,
    ),
});

export const manageServiceRedirectionsTool = defineMailMutationTool({
  name: "infomaniak_manage_service_redirections",
  description:
    "List, create, update, delete, enable, and confirm service-level redirections. Also exposes target-list and confirmation resend helpers.",
  inputSchema: RedirectionInput,
  loadCurrent: async (input) => readServiceRedirections(input.mail_hosting_id),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    action: input.action,
    current_redirections: current,
    ...(input.redirection_id !== undefined
      ? { redirection_id: input.redirection_id }
      : {}),
    ...(input.target_id !== undefined ? { target_id: input.target_id } : {}),
    ...(input.target !== undefined ? { target: input.target } : {}),
    ...(input.payload !== undefined ? { payload: input.payload } : {}),
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const base = `/1/mail_hostings/${input.mail_hosting_id}/redirections`;
    let result: unknown;
    switch (input.action) {
      case "list":
        result = await client.request<unknown>("GET", base);
        break;
      case "create":
        result = await client.request<unknown>("POST", base, {
          body: input.payload ?? {},
        });
        break;
      case "update":
        if (!input.redirection_id)
          throw new Error("redirection_id is required when action=update");
        result = await client.request<unknown>(
          "PUT",
          `${base}/${input.redirection_id}`,
          {
            body: input.payload ?? {},
          },
        );
        break;
      case "delete":
        if (!input.redirection_id)
          throw new Error("redirection_id is required when action=delete");
        result = await client.request<unknown>(
          "DELETE",
          `${base}/${input.redirection_id}`,
        );
        break;
      case "enable":
        if (!input.redirection_id)
          throw new Error("redirection_id is required when action=enable");
        result = await client.request<unknown>(
          "PUT",
          `${base}/${input.redirection_id}/enable`,
        );
        break;
      case "list_targets":
        if (!input.redirection_id)
          throw new Error(
            "redirection_id is required when action=list_targets",
          );
        result = await client.request<unknown>(
          "GET",
          `${base}/${input.redirection_id}/targets`,
        );
        break;
      case "add_target":
        if (!input.redirection_id)
          throw new Error("redirection_id is required when action=add_target");
        result = await client.request<unknown>(
          "POST",
          `${base}/${input.redirection_id}/targets`,
          {
            body: input.payload ?? {},
          },
        );
        break;
      case "remove_target":
        if (!input.redirection_id)
          throw new Error(
            "redirection_id is required when action=remove_target",
          );
        result = await client.request<unknown>(
          "DELETE",
          `${base}/${input.redirection_id}/targets`,
          {
            body:
              input.payload ?? (input.target ? { target: input.target } : {}),
          },
        );
        break;
      case "resend_confirmation":
        if (!input.redirection_id)
          throw new Error(
            "redirection_id is required when action=resend_confirmation",
          );
        result = await client.request<unknown>(
          "PUT",
          `${base}/${input.redirection_id}/send-confirmation-requests`,
        );
        break;
      case "resend_target_confirmation":
        if (!input.redirection_id || !input.target_id) {
          throw new Error(
            "redirection_id and target_id are required when action=resend_target_confirmation",
          );
        }
        result = await client.request<unknown>(
          "PUT",
          `${base}/${input.redirection_id}/targets/${input.target_id}/resend-confirmation-request`,
        );
        break;
    }
    recordHistory({
      tool: "infomaniak_manage_service_redirections",
      kind: "mail_admin",
      summary: `Service redirections ${input.action} on ${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        action: input.action,
        ...(input.redirection_id !== undefined
          ? { redirection_id: input.redirection_id }
          : {}),
        ...(input.target_id !== undefined
          ? { target_id: input.target_id }
          : {}),
        ...(input.target !== undefined ? { target: input.target } : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      action: input.action,
      result,
      message: `✅ Service redirections ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "manage service redirections",
      input.mail_hosting_id,
      plan,
      token,
    ),
});

export const rotateMailDkimTool = defineMailMutationTool({
  name: "infomaniak_rotate_mail_dkim",
  description:
    "Check or rotate the DKIM key for a mail hosting. The check path is read-only; rotate uses two-phase confirmation.",
  inputSchema: DkimInput,
  loadCurrent: async (input) => readDkimRotationState(input.mail_hosting_id),
  buildPlan: (input, current) => ({
    mail_hosting_id: input.mail_hosting_id,
    action: input.action,
    current_dkim_state: current,
  }),
  apply: async (input) => {
    const client = new PublicApiClient();
    const path = `/1/mail_hostings/${input.mail_hosting_id}/diagnostic/dkim/rotate`;
    const result =
      input.action === "check"
        ? await client.request<unknown>("GET", path)
        : await client.request<unknown>("POST", path);
    recordHistory({
      tool: "infomaniak_rotate_mail_dkim",
      kind: "mail_admin",
      summary: `${input.action === "check" ? "Checked" : "Rotated"} DKIM for mail hosting ${input.mail_hosting_id}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        action: input.action,
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      action: input.action,
      result,
      message:
        input.action === "check"
          ? "✅ DKIM rotation check completed."
          : "✅ DKIM rotation triggered.",
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderGenericPlanMarkdown(
      "rotate mail DKIM",
      input.mail_hosting_id,
      plan,
      token,
    ),
});

function defineMailMutationTool<
  TInput extends z.ZodTypeAny,
  TCurrent,
  TPlan extends Record<string, unknown>,
  TApplied extends Record<string, unknown>,
>(config: {
  name: string;
  description: string;
  inputSchema: TInput;
  loadCurrent: (input: z.infer<TInput>) => Promise<TCurrent>;
  buildPlan: (input: z.infer<TInput>, current: TCurrent) => TPlan;
  apply: (
    input: z.infer<TInput>,
    plan: TPlan,
    current: TCurrent,
  ) => Promise<TApplied>;
  renderPlanMarkdown: (
    input: z.infer<TInput>,
    plan: TPlan,
    token: string,
  ) => string;
}): ReturnType<typeof defineTool> {
  return defineTool({
    name: config.name,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: GenericMutationOutput,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true,
    },
    capability: {
      scope: "admin",
      risk: "destructive",
      confirmationRequired: true,
    },
    handler: createMutationGuardedHandler({
      toolName: config.name,
      loadCurrent: config.loadCurrent,
      buildPlan: config.buildPlan,
      apply: config.apply,
      renderPlanMarkdown: config.renderPlanMarkdown,
    }),
  });
}

async function readMailboxAliases(
  mailHostingId: number,
  mailboxName: string,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/mail_hostings/${mailHostingId}/mailboxes/${encodeURIComponent(mailboxName)}/aliases`,
  );
}

async function readMailboxForwarding(
  mailHostingId: number,
  mailboxName: string,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/mail_hostings/${mailHostingId}/mailboxes/${encodeURIComponent(mailboxName)}/forwarding_addresses`,
  );
}

async function readMailboxAutoReplyModels(
  mailHostingId: number,
  mailboxName: string,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/mail_hostings/${mailHostingId}/mailboxes/${encodeURIComponent(mailboxName)}/auto_reply/model`,
  );
}

async function readServiceRedirections(
  mailHostingId: number,
): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/mail_hostings/${mailHostingId}/redirections`,
  );
}

async function readDkimRotationState(mailHostingId: number): Promise<unknown> {
  const client = new PublicApiClient();
  return await client.request<unknown>(
    "GET",
    `/1/mail_hostings/${mailHostingId}/diagnostic/dkim/rotate`,
  );
}

function renderGenericPlanMarkdown(
  title: string,
  mailHostingId: number,
  plan: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan — ${title}`,
    ``,
    `- **Mail hosting**: ${mailHostingId}`,
    `- **Action**: ${String(plan["action"] ?? "update")}`,
    ``,
    `### Target snapshot`,
    `\`\`\`json`,
    `${JSON.stringify(plan, null, 2)}`,
    `\`\`\``,
    ``,
    `### Next step`,
    `Re-call with \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}
