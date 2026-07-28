import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { createMutationGuardedHandler } from "../runtime/mutation-guard.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

const GenericMutationOutput = z
  .union([
    z
      .object({ status: z.literal("plan"), confirmation_token: z.string(), token_expires_at: z.string(), next_step_markdown: z.string() })
      .passthrough(),
    z.object({ status: z.literal("applied"), message: z.string() }).passthrough(),
  ]);

const PublicCloudIdInput = z.object({ public_cloud_id: z.number().int().positive() });
const ProjectInput = PublicCloudIdInput.extend({ project_id: z.number().int().positive() });
const Payload = z.record(z.unknown()).default({});

export const listPublicCloudsTool = defineTool({
  name: "infomaniak_list_public_clouds",
  description: "List Public Cloud products available to the current account.",
  inputSchema: z.object({}),
  outputSchema: z.object({ public_clouds: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async () => ({ public_clouds: await new PublicApiClient().request<unknown[]>("GET", "/1/public_clouds") }),
});

export const getPublicCloudTool = defineTool({
  name: "infomaniak_get_public_cloud",
  description: "Read one Public Cloud product snapshot.",
  inputSchema: PublicCloudIdInput,
  outputSchema: z.object({ public_cloud_id: z.number(), public_cloud: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    public_cloud: await new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}`),
  }),
});

export const listPublicCloudAccessesTool = defineTool({
  name: "infomaniak_list_public_cloud_accesses",
  description: "List Public Cloud account accesses.",
  inputSchema: z.object({}),
  outputSchema: z.object({ accesses: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async () => ({ accesses: await new PublicApiClient().request<unknown>("GET", "/1/public_clouds/accesses") }),
});

export const getPublicCloudStatusTool = defineTool({
  name: "infomaniak_get_public_cloud_status",
  description: "Read the current Infomaniak Public Cloud service status feed.",
  inputSchema: z.object({}),
  outputSchema: z.object({ status: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async () => ({
    status: await new PublicApiClient().request<unknown>("GET", "/2/events/public-cloud-status"),
  }),
});

export const listPublicCloudProjectsTool = defineTool({
  name: "infomaniak_list_public_cloud_projects",
  description: "List projects within a Public Cloud product.",
  inputSchema: PublicCloudIdInput,
  outputSchema: z.object({ public_cloud_id: z.number(), projects: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    projects: await new PublicApiClient().request<unknown[]>("GET", `/1/public_clouds/${input.public_cloud_id}/projects`),
  }),
});

export const getPublicCloudProjectTool = defineTool({
  name: "infomaniak_get_public_cloud_project",
  description: "Read one Public Cloud project.",
  inputSchema: ProjectInput,
  outputSchema: z.object({ public_cloud_id: z.number(), project_id: z.number(), project: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    project_id: input.project_id,
    project: await new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}`),
  }),
});

export const listPublicCloudProjectUsersTool = defineTool({
  name: "infomaniak_list_public_cloud_project_users",
  description: "List users with access to a Public Cloud project.",
  inputSchema: ProjectInput,
  outputSchema: z.object({ public_cloud_id: z.number(), project_id: z.number(), users: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    project_id: input.project_id,
    users: await new PublicApiClient().request<unknown[]>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/users`),
  }),
});

export const listPublicCloudDatabaseServicesTool = defineTool({
  name: "infomaniak_list_public_cloud_database_services",
  description: "List Public Cloud DBaaS services globally or within a project.",
  inputSchema: PublicCloudIdInput.extend({ project_id: z.number().int().positive().optional() }),
  outputSchema: z.object({ public_cloud_id: z.number(), services: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    services: await new PublicApiClient().request<unknown[]>("GET", input.project_id === undefined
      ? "/1/public_clouds/dbaas"
      : `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/dbaas`),
  }),
});

export const getPublicCloudDatabaseServiceTool = defineTool({
  name: "infomaniak_get_public_cloud_database_service",
  description: "Read one Public Cloud DBaaS service.",
  inputSchema: ProjectInput.extend({ dbaas_id: z.number().int().positive() }),
  outputSchema: z.object({ public_cloud_id: z.number(), project_id: z.number(), dbaas_id: z.number(), service: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    project_id: input.project_id,
    dbaas_id: input.dbaas_id,
    service: await new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/dbaas/${input.dbaas_id}`),
  }),
});

export const listPublicCloudKubernetesServicesTool = defineTool({
  name: "infomaniak_list_public_cloud_kubernetes_services",
  description: "List Public Cloud Kubernetes services globally or within a project.",
  inputSchema: PublicCloudIdInput.extend({ project_id: z.number().int().positive().optional() }),
  outputSchema: z.object({ public_cloud_id: z.number(), services: z.array(z.unknown()) }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    services: await new PublicApiClient().request<unknown[]>("GET", input.project_id === undefined
      ? "/1/public_clouds/kaas"
      : `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/kaas`),
  }),
});

export const getPublicCloudKubernetesServiceTool = defineTool({
  name: "infomaniak_get_public_cloud_kubernetes_service",
  description: "Read one Public Cloud Kubernetes service.",
  inputSchema: ProjectInput.extend({ kaas_id: z.number().int().positive() }),
  outputSchema: z.object({ public_cloud_id: z.number(), project_id: z.number(), kaas_id: z.number(), service: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    public_cloud_id: input.public_cloud_id,
    project_id: input.project_id,
    kaas_id: input.kaas_id,
    service: await new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/kaas/${input.kaas_id}`),
  }),
});

const PublicCloudDataInput = z.object({
  resource: z.enum(["config", "dbaas_configurations", "dbaas_regions", "dbaas_packs", "dbaas_types", "kaas_packs", "kaas_versions", "kaas_regions", "kaas_availability_zones"]),
});

export const listPublicCloudResourceDataTool = defineTool({
  name: "infomaniak_list_public_cloud_resource_data",
  description: "List Public Cloud configuration and service catalog data such as regions, packs, types, and Kubernetes versions.",
  inputSchema: PublicCloudDataInput,
  outputSchema: z.object({ resource: z.string(), data: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({ resource: input.resource, data: await new PublicApiClient().request<unknown>("GET", publicCloudDataPath(input.resource)) }),
});

const ProjectMutationInput = PublicCloudIdInput.extend({
  action: z.enum(["create", "update", "delete", "invite"]),
  project_id: z.number().int().positive().optional(),
  payload: Payload,
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if ((input.action === "update" || input.action === "delete") && input.project_id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["project_id"], message: "project_id is required for this action." });
  }
});

export const managePublicCloudProjectTool = defineTool({
  name: "infomaniak_manage_public_cloud_project",
  description: "Create, update, delete, or create-with-invitation a Public Cloud project using two-phase confirmation.",
  inputSchema: ProjectMutationInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<z.infer<typeof ProjectMutationInput>, unknown, { plan: { action: string; payload: Record<string, unknown> }; current_projects: unknown }, { result: unknown; message: string }>({
    toolName: "infomaniak_manage_public_cloud_project",
    loadCurrent: async (input) => input.action === "create" || input.action === "invite"
      ? new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects`)
      : new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${requireId(input.project_id, "project_id")}`),
    buildPlan: (input, current_projects) => ({ plan: { action: input.action, payload: input.payload }, current_projects }),
    apply: async (input, plan) => {
      const client = new PublicApiClient();
      const base = `/1/public_clouds/${input.public_cloud_id}/projects`;
      const projectId = input.project_id === undefined ? "" : `/${input.project_id}`;
      const [method, path] = input.action === "create" ? ["POST", base] : input.action === "invite" ? ["POST", `${base}/invite`] : input.action === "update" ? ["PATCH", `${base}${projectId}`] : ["DELETE", `${base}${projectId}`];
      const result = await client.request<unknown>(method as "POST" | "PATCH" | "DELETE", path, input.action === "delete" ? {} : { body: plan.plan.payload });
      recordHistory({ tool: "infomaniak_manage_public_cloud_project", kind: "account_admin", summary: `${input.action}d Public Cloud project`, payload: { public_cloud_id: input.public_cloud_id, project_id: input.project_id } });
      return { result, message: `✅ Public Cloud project ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => `## Plan — Public Cloud project\n\n- **Action**: ${plan.plan.action}\n- **Payload**: \`${JSON.stringify(plan.plan.payload)}\`\n\nRe-call with the same parameters and \`confirmation_token: "${token}"\`.`,
  }),
});

const ProjectUserMutationInput = ProjectInput.extend({
  action: z.enum(["create", "update", "delete", "invite", "invite_existing"]),
  user_id: z.number().int().positive().optional(),
  payload: Payload,
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if (["update", "delete", "invite_existing"].includes(input.action) && input.user_id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["user_id"], message: "user_id is required for this action." });
  }
});

export const managePublicCloudProjectUserTool = defineTool({
  name: "infomaniak_manage_public_cloud_project_user",
  description: "Create, update, delete, or invite a Public Cloud project user with two-phase confirmation.",
  inputSchema: ProjectUserMutationInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<z.infer<typeof ProjectUserMutationInput>, unknown, { plan: { action: string; payload: Record<string, unknown> }; current_users: unknown }, { result: unknown; message: string }>({
    toolName: "infomaniak_manage_public_cloud_project_user",
    loadCurrent: async (input) => new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/users`),
    buildPlan: (input, current_users) => ({ plan: { action: input.action, payload: input.payload }, current_users }),
    apply: async (input, plan) => {
      const base = `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/users`;
      const userId = input.user_id === undefined ? "" : `/${input.user_id}`;
      const [method, path] = input.action === "create" ? ["POST", base] : input.action === "invite" ? ["POST", `${base}/invite`] : input.action === "invite_existing" ? ["POST", `${base}${userId}/invite`] : input.action === "update" ? ["PATCH", `${base}${userId}`] : ["DELETE", `${base}${userId}`];
      const result = await new PublicApiClient().request<unknown>(method as "POST" | "PATCH" | "DELETE", path, input.action === "delete" ? {} : { body: plan.plan.payload });
      recordHistory({ tool: "infomaniak_manage_public_cloud_project_user", kind: "account_admin", summary: `${input.action}d Public Cloud project user`, payload: { public_cloud_id: input.public_cloud_id, project_id: input.project_id, user_id: input.user_id } });
      return { result, message: `✅ Public Cloud project user ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => `## Plan — Public Cloud project user\n\n- **Action**: ${plan.plan.action}\n- **Payload**: \`${JSON.stringify(plan.plan.payload)}\`\n\nRe-call with the same parameters and \`confirmation_token: "${token}"\`.`,
  }),
});

const DbaasMutationInput = ProjectInput.extend({
  action: z.enum(["create", "update", "delete", "reset_password", "toggle_slow_logs"]),
  dbaas_id: z.number().int().positive().optional(),
  payload: Payload,
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if (input.action !== "create" && input.dbaas_id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dbaas_id"], message: "dbaas_id is required for this action." });
  }
});

export const managePublicCloudDatabaseServiceTool = defineTool({
  name: "infomaniak_manage_public_cloud_database_service",
  description: "Manage Public Cloud DBaaS lifecycle and operational actions with two-phase confirmation.",
  inputSchema: DbaasMutationInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<z.infer<typeof DbaasMutationInput>, unknown, { plan: { action: string; payload: Record<string, unknown> }; current_service: unknown }, { result: unknown; message: string }>({
    toolName: "infomaniak_manage_public_cloud_database_service",
    loadCurrent: async (input) => input.action === "create"
      ? new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/dbaas`)
      : new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/dbaas/${requireId(input.dbaas_id, "dbaas_id")}`),
    buildPlan: (input, current_service) => ({ plan: { action: input.action, payload: input.payload }, current_service }),
    apply: async (input, plan) => {
      const base = `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/dbaas`;
      const id = input.dbaas_id === undefined ? "" : `/${input.dbaas_id}`;
      const suffix = input.action === "reset_password" ? "/reset_password" : input.action === "toggle_slow_logs" ? "/toggle_slow_logs" : "";
      const method = input.action === "create" ? "POST" : input.action === "update" ? "PATCH" : input.action === "delete" ? "DELETE" : "POST";
      const result = await new PublicApiClient().request<unknown>(method, input.action === "create" ? base : `${base}${id}${suffix}`, input.action === "delete" ? {} : { body: plan.plan.payload });
      recordHistory({ tool: "infomaniak_manage_public_cloud_database_service", kind: "account_admin", summary: `${input.action}d Public Cloud DBaaS service`, payload: { public_cloud_id: input.public_cloud_id, project_id: input.project_id, dbaas_id: input.dbaas_id } });
      return { result, message: `✅ Public Cloud DBaaS action ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => `## Plan — Public Cloud DBaaS\n\n- **Action**: ${plan.plan.action}\n- **Payload**: \`${JSON.stringify(plan.plan.payload)}\`\n\nRe-call with the same parameters and \`confirmation_token: "${token}"\`.`,
  }),
});

const KubernetesMutationInput = ProjectInput.extend({
  action: z.enum(["create", "update", "delete"]),
  kaas_id: z.number().int().positive().optional(),
  payload: Payload,
  confirmation_token: z.string().uuid().optional(),
}).superRefine((input, ctx) => {
  if (input.action !== "create" && input.kaas_id === undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["kaas_id"], message: "kaas_id is required for this action." });
  }
});

export const managePublicCloudKubernetesServiceTool = defineTool({
  name: "infomaniak_manage_public_cloud_kubernetes_service",
  description: "Create, update, or delete a Public Cloud Kubernetes service with two-phase confirmation.",
  inputSchema: KubernetesMutationInput,
  outputSchema: GenericMutationOutput,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  capability: { scope: "admin", risk: "destructive", confirmationRequired: true },
  handler: createMutationGuardedHandler<z.infer<typeof KubernetesMutationInput>, unknown, { plan: { action: string; payload: Record<string, unknown> }; current_service: unknown }, { result: unknown; message: string }>({
    toolName: "infomaniak_manage_public_cloud_kubernetes_service",
    loadCurrent: async (input) => input.action === "create"
      ? new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/kaas`)
      : new PublicApiClient().request<unknown>("GET", `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/kaas/${requireId(input.kaas_id, "kaas_id")}`),
    buildPlan: (input, current_service) => ({ plan: { action: input.action, payload: input.payload }, current_service }),
    apply: async (input, plan) => {
      const base = `/1/public_clouds/${input.public_cloud_id}/projects/${input.project_id}/kaas`;
      const path = input.action === "create" ? base : `${base}/${requireId(input.kaas_id, "kaas_id")}`;
      const method = input.action === "create" ? "POST" : input.action === "update" ? "PATCH" : "DELETE";
      const result = await new PublicApiClient().request(method, path, input.action === "delete" ? {} : { body: plan.plan.payload });
      recordHistory({ tool: "infomaniak_manage_public_cloud_kubernetes_service", kind: "account_admin", summary: `${input.action}d Public Cloud KaaS service`, payload: { public_cloud_id: input.public_cloud_id, project_id: input.project_id, kaas_id: input.kaas_id } });
      return { result, message: `✅ Public Cloud KaaS action ${input.action}d.` };
    },
    renderPlanMarkdown: (input, plan, token) => `## Plan — Public Cloud KaaS\n\n- **Action**: ${plan.plan.action}\n- **Payload**: \`${JSON.stringify(plan.plan.payload)}\`\n\nRe-call with the same parameters and \`confirmation_token: "${token}"\`.`,
  }),
});

function publicCloudDataPath(resource: z.infer<typeof PublicCloudDataInput>["resource"]): string {
  switch (resource) {
    case "config": return "/1/public_clouds/config";
    case "dbaas_configurations": return "/1/public_clouds/dbaas/configurations";
    case "dbaas_regions": return "/1/public_clouds/dbaas/regions";
    case "dbaas_packs": return "/1/public_clouds/dbaas/packs";
    case "dbaas_types": return "/1/public_clouds/dbaas/types";
    case "kaas_packs": return "/1/public_clouds/kaas/packs";
    case "kaas_versions": return "/1/public_clouds/kaas/versions";
    case "kaas_regions": return "/1/public_clouds/kaas/regions";
    case "kaas_availability_zones": return "/1/public_clouds/kaas/availability_zones";
  }
}

function requireId(value: number | undefined, name: string): number {
  if (value === undefined) throw new Error(`${name} is required for this action.`);
  return value;
}
