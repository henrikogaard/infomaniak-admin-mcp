import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const MailSignatureContextInput = z.object({
  mail_hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Mail hosting ID. Discover via infomaniak_list_mail_hostings."),
  mailbox_name: z
    .string()
    .min(1)
    .optional()
    .describe("Mailbox local part (required when scope=mailbox)."),
  scope: z
    .enum(["mailbox", "service"])
    .describe("Whether the action targets a mailbox or the hosting service."),
  resource: z
    .enum(["signature", "template"])
    .describe("Whether the action targets a signature or a template."),
});

const MailSignatureIdentifier = z.union([
  z.string().min(1),
  z.number().int().positive(),
]);

const MailSignatureReadInput = MailSignatureContextInput.extend({
  action: z.enum(["list", "show", "show_default"]),
  signature_id: MailSignatureIdentifier.optional(),
  template_id: MailSignatureIdentifier.optional(),
});

const MailSignatureWriteInput = MailSignatureContextInput.extend({
  action: z.enum([
    "create",
    "update",
    "delete",
    "upload",
    "set_defaults",
    "create_signatures",
  ]),
  signature_id: MailSignatureIdentifier.optional(),
  template_id: MailSignatureIdentifier.optional(),
  payload: z
    .record(z.unknown())
    .optional()
    .describe("Raw request body to send to Infomaniak for this operation."),
  confirmation_token: z.string().uuid().optional(),
});

const ReadOutput = z.object({
  mail_hosting_id: z.number(),
  mailbox_name: z.string().optional(),
  scope: z.enum(["mailbox", "service"]),
  resource: z.enum(["signature", "template"]),
  action: z.enum(["list", "show", "show_default"]),
  result: z.unknown(),
});

const ConfirmedOutput = z.union([
  z.object({
    status: z.literal("plan"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string().optional(),
    scope: z.enum(["mailbox", "service"]),
    resource: z.enum(["signature", "template"]),
    action: z.enum([
      "create",
      "update",
      "delete",
      "upload",
      "set_defaults",
      "create_signatures",
    ]),
    current: z.unknown(),
    mutation: z.object({
      method: z.enum(["POST", "PUT", "PATCH", "DELETE"]),
      path: z.string(),
      body: z.record(z.unknown()).optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    mail_hosting_id: z.number(),
    mailbox_name: z.string().optional(),
    scope: z.enum(["mailbox", "service"]),
    resource: z.enum(["signature", "template"]),
    action: z.enum([
      "create",
      "update",
      "delete",
      "upload",
      "set_defaults",
      "create_signatures",
    ]),
    result: z.unknown().optional(),
    message: z.string(),
  }),
]);

export const getMailSignaturesTool = defineTool({
  name: "infomaniak_get_mail_signatures",
  description:
    "Inspect mailbox signatures and signature templates at the mailbox or service level. Read-only inventory for admin review and template selection.",
  inputSchema: MailSignatureReadInput,
  outputSchema: ReadOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => {
    const client = new PublicApiClient();
    const path = resolveMailSignatureReadPath(input, input.action);
    const result = await client.request<unknown>("GET", path);
    recordHistory({
      tool: "infomaniak_get_mail_signatures",
      kind: "mail_admin",
      summary: `Read ${input.scope} ${input.resource} signatures for ${describeMailSignatureTarget(input)}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        scope: input.scope,
        resource: input.resource,
        action: input.action,
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      scope: input.scope,
      resource: input.resource,
      action: input.action,
      result,
    };
  },
});

export const manageMailSignaturesTool = defineMailMutationTool({
  name: "infomaniak_manage_mail_signatures",
  description:
    "Create, update, delete, upload, set defaults, or generate signatures from templates. Uses two-phase confirmation and refetches the current signature or template state before apply.",
  inputSchema: MailSignatureWriteInput,
  loadCurrent: async (input) => readMailSignatureCurrent(input),
  buildPlan: (input, current) => {
    const mutation = buildMailSignatureMutation(input);
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      scope: input.scope,
      resource: input.resource,
      action: input.action,
      current,
      mutation,
    };
  },
  apply: async (input) => {
    const client = new PublicApiClient();
    const mutation = buildMailSignatureMutation(input);
    const result = await client.request<unknown>(
      mutation.method,
      mutation.path,
      {
        body: mutation.body,
      },
    );
    recordHistory({
      tool: "infomaniak_manage_mail_signatures",
      kind: "mail_admin",
      summary: `${input.action} ${input.scope} ${input.resource} signatures for ${describeMailSignatureTarget(input)}`,
      payload: {
        mail_hosting_id: input.mail_hosting_id,
        mailbox_name: input.mailbox_name,
        scope: input.scope,
        resource: input.resource,
        action: input.action,
        ...(input.signature_id !== undefined
          ? { signature_id: input.signature_id }
          : {}),
        ...(input.template_id !== undefined
          ? { template_id: input.template_id }
          : {}),
        ...(input.payload !== undefined ? { payload: input.payload } : {}),
      },
    });
    return {
      mail_hosting_id: input.mail_hosting_id,
      ...(input.mailbox_name ? { mailbox_name: input.mailbox_name } : {}),
      scope: input.scope,
      resource: input.resource,
      action: input.action,
      result,
      message: `✅ Mail signatures ${input.action}.`,
    };
  },
  renderPlanMarkdown: (input, plan, token) =>
    renderMailSignaturePlanMarkdown(input, plan, token),
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
    outputSchema: ConfirmedOutput,
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

async function readMailSignatureCurrent(
  input: z.infer<typeof MailSignatureWriteInput>,
): Promise<unknown> {
  const client = new PublicApiClient();
  const action =
    input.action === "create" ||
    input.action === "upload" ||
    input.action === "set_defaults"
      ? "list"
      : "show";
  return await client.request<unknown>(
    "GET",
    resolveMailSignatureReadPath(input, action),
  );
}

function buildMailSignatureMutation(
  input: z.infer<typeof MailSignatureWriteInput>,
): {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  body?: Record<string, unknown>;
} {
  const path = resolveMailSignaturePath(input, input.action);
  switch (input.action) {
    case "create":
      return { method: "POST", path, body: input.payload ?? {} };
    case "update":
      return {
        method: input.resource === "signature" ? "PATCH" : "PUT",
        path,
        body: input.payload ?? {},
      };
    case "delete":
      return { method: "DELETE", path };
    case "upload":
      return { method: "POST", path, body: input.payload ?? {} };
    case "set_defaults":
      return { method: "POST", path, body: input.payload ?? {} };
    case "create_signatures":
      return { method: "POST", path, body: input.payload ?? {} };
  }
}

function resolveMailSignatureReadPath(
  input:
    | z.infer<typeof MailSignatureReadInput>
    | z.infer<typeof MailSignatureWriteInput>,
  action: "list" | "show" | "show_default",
): string {
  if (input.scope === "mailbox") {
    const mailboxName = requireMailboxName(input);
    const base =
      input.resource === "signature"
        ? `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(mailboxName)}/signatures`
        : `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(mailboxName)}/signatures/templates`;
    if (action === "list") {
      return base;
    }
    if (action === "show_default") {
      throw new Error(
        "show_default is only valid for service-level signature templates",
      );
    }
    return `${base}/${encodeURIComponent(requireSignatureOrTemplateId(input))}`;
  }

  const base = `/1/mail_hostings/${input.mail_hosting_id}/signatures/templates`;
  if (input.resource === "signature") {
    throw new Error("service-level mailbox signatures are not supported");
  }
  if (action === "show_default") {
    return `${base}/default`;
  }
  if (action === "list") {
    return base;
  }
  return `${base}/${encodeURIComponent(requireSignatureOrTemplateId(input))}`;
}

function resolveMailSignaturePath(
  input: z.infer<typeof MailSignatureWriteInput>,
  action: z.infer<typeof MailSignatureWriteInput>["action"],
): string {
  if (input.scope === "mailbox") {
    const mailboxName = requireMailboxName(input);
    const base =
      input.resource === "signature"
        ? `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(mailboxName)}/signatures`
        : `/1/mail_hostings/${input.mail_hosting_id}/mailboxes/${encodeURIComponent(mailboxName)}/signatures/templates`;

    switch (action) {
      case "create":
      case "upload":
        return base;
      case "update":
      case "delete":
        return `${base}/${encodeURIComponent(requireSignatureOrTemplateId(input))}`;
      case "set_defaults":
        if (input.resource !== "signature") {
          throw new Error("set_defaults is only valid for mailbox signatures");
        }
        return `${base}/set_defaults`;
      case "create_signatures":
        if (input.resource !== "template") {
          throw new Error(
            "create_signatures is only valid for signature templates",
          );
        }
        return `${base}/${encodeURIComponent(requireSignatureOrTemplateId(input))}/create_signatures`;
    }
  }

  if (input.resource !== "template") {
    throw new Error("service-level signature writes only support templates");
  }
  const base = `/1/mail_hostings/${input.mail_hosting_id}/signatures/templates`;
  switch (action) {
    case "create":
    case "upload":
      return base;
    case "update":
    case "delete":
      return `${base}/${encodeURIComponent(requireSignatureOrTemplateId(input))}`;
    case "create_signatures":
      return `${base}/${encodeURIComponent(requireSignatureOrTemplateId(input))}/create_signatures`;
    case "set_defaults":
      throw new Error("set_defaults is only valid for mailbox signatures");
  }
}

function requireMailboxName(input: {
  mailbox_name?: string | undefined;
}): string {
  if (!input.mailbox_name) {
    throw new Error("mailbox_name is required when scope=mailbox");
  }
  return input.mailbox_name;
}

function requireSignatureOrTemplateId(input: {
  signature_id?: string | number | undefined;
  template_id?: string | number | undefined;
  resource: "signature" | "template";
}): string | number {
  const value =
    input.resource === "signature" ? input.signature_id : input.template_id;
  if (value === undefined || value === null || value === "") {
    throw new Error(`${input.resource}_id is required for this action`);
  }
  return value;
}

function describeMailSignatureTarget(input: {
  scope: "mailbox" | "service";
  resource: "signature" | "template";
  mailbox_name?: string | undefined;
}): string {
  if (input.scope === "mailbox") {
    return input.mailbox_name ? `${input.mailbox_name} mailbox` : "mailbox";
  }
  return "service mail";
}

function renderMailSignaturePlanMarkdown(
  input: z.infer<typeof MailSignatureWriteInput>,
  plan: Record<string, unknown>,
  token: string,
): string {
  return [
    `## Plan - manage mail signatures`,
    ``,
    `- **Mail hosting**: ${input.mail_hosting_id}`,
    `- **Scope**: ${input.scope}`,
    `- **Resource**: ${input.resource}`,
    `- **Action**: ${input.action}`,
    `- **Endpoint**: \`${String(plan["mutation"] && typeof plan["mutation"] === "object" ? (plan["mutation"] as Record<string, unknown>)["path"] : "")}\``,
    ``,
    `### Current state`,
    `\`\`\`json`,
    `${JSON.stringify(plan["current"], null, 2)}`,
    `\`\`\``,
    ``,
    `### Mutation`,
    `\`\`\`json`,
    `${JSON.stringify(plan["mutation"], null, 2)}`,
    `\`\`\``,
    ``,
    `### Next step`,
    `Re-call with \`confirmation_token: "${token}"\`.`,
  ].join("\n");
}
