import { z } from "zod";

import { ManagerApiClient } from "../infomaniak/client.js";
import {
  consumeConfirmationToken,
  mintConfirmationToken,
} from "../runtime/confirmation-store.js";
import { recordHistory } from "../runtime/history.js";

import { defineTool } from "./types.js";

// Shared schemas

const NodejsEnvironmentSchema = z.object({
  version: z.string(),
  version_status: z.string().optional(),
  start_command: z.string(),
  build_command: z.string(),
  port: z.number(),
});

const IpRecordSchema = z.object({
  host: z.string(),
  type: z.enum(["IPv4", "IPv6"]),
});

const StorageSchema = z.object({
  capacity: z.string(),
  capacity_used: z.string(),
  capacity_available: z.string(),
});

const NodejsAppDetailSchema = z.object({
  id: z.number(),
  unique_id: z.number().optional(),
  service_id: z.number().optional(),
  customer_name: z.string().optional(),
  tags: z.array(z.unknown()).optional(),
  feature_id: z.number(),
  has_maintenance: z.boolean().optional(),
  main_fqdn: z.string(),
  is_main_preview: z.boolean().optional(),
  preview_url: z.string().optional(),
  directory: z.string(),
  is_protected: z.boolean().optional(),
  ssl_status: z.string().optional(),
  ips: z.array(IpRecordSchema).optional(),
  storage: StorageSchema.optional(),
  environment: NodejsEnvironmentSchema.optional(),
  state: z.string(),
  created_at: z.number().optional(),
});

const HostingFeatureSchema = z.object({
  id: z.number(),
  feature: z.string(),
  feature_type: z.string(),
  hosting_feature_parent_id: z.number().nullable(),
  fqdns: z
    .array(
      z.object({
        id: z.number(),
        hosting_id: z.number(),
        source: z.string(),
        domain: z.string(),
        path: z.string().optional(),
        type: z.string(),
        created_at: z.string().optional(),
        updated_at: z.string().optional(),
        deleted_at: z.string().nullable().optional(),
      }),
    )
    .optional(),
  created_at: z.number().optional(),
  updated_at: z.number().optional(),
});

const NodejsJobSchema = z.object({
  resource_id: z.string(),
  status: z.string(),
  log_stream: z
    .object({
      endpoint: z.string(),
      jwt_token: z.string(),
    })
    .optional(),
  created_at: z.number().optional(),
});

const VhostAliasSchema = z.object({
  name: z.string(),
  fqdn_idn: z.string(),
  can_update_dns: z.boolean().optional(),
  is_main: z.boolean(),
  is_protected: z.boolean().optional(),
  is_preview: z.boolean(),
});

// list_nodejs_apps: list apps on a hosting

const ListNodejsAppsInput = z.object({
  hosting_id: z
    .number()
    .int()
    .positive()
    .describe("Node.js hosting id (service_id 57)."),
});

const ListNodejsAppsOutput = z.object({
  hosting_id: z.number(),
  hosting_name: z.string(),
  hosting_state: z.string(),
  apps: z.array(
    z.object({
      vhost_route_id: z.number(),
      webapp_feature_id: z.number(),
      fqdns: z.array(z.string()),
    }),
  ),
});

export const listNodejsAppsTool = defineTool({
  name: "infomaniak_list_nodejs_apps",
  description:
    "List Node.js applications running on a `hosting_3` (Cloud Server Node.js) container. Each Infomaniak Node.js hosting runs a single app, so this typically returns one entry. Returns the vhost_route_id needed for every other Node.js tool, and the FQDNs serving the app. Manager-private endpoint — requires SASESSION + CSRF cookies (set INFOMANIAK_AUTH_MODE=auto).",
  inputSchema: ListNodejsAppsInput,
  outputSchema: ListNodejsAppsOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const raw = await client.request<{
      id: number;
      name: string;
      state: string;
      hosting_features: unknown[];
    }>("GET", `/proxy/1/hostings/${input.hosting_id}`, {
      query: { "with[]": "hosting_features" },
    });

    // Drop unsupported hosting feature nodes.
    const features = raw.hosting_features
      .map((f) => HostingFeatureSchema.safeParse(f))
      .filter((r) => r.success)
      .map((r) => r.data);

    const webApps = features.filter((f) => f.feature_type === "WebApp");
    const apps = webApps.map((webapp) => {
      const vhostRoute = features.find(
        (f) =>
          f.feature_type === "VhostRoute" &&
          f.hosting_feature_parent_id === webapp.id,
      );
      const fqdns = (vhostRoute?.fqdns ?? []).map((f) =>
        f.path && f.path !== ""
          ? `${f.source}.${f.domain}${f.path}`
          : `${f.source}.${f.domain}`,
      );
      return {
        vhost_route_id: vhostRoute?.id ?? webapp.id,
        webapp_feature_id: webapp.id,
        fqdns,
      };
    });

    return {
      hosting_id: raw.id,
      hosting_name: raw.name,
      hosting_state: raw.state,
      apps,
    };
  },
});

// get_nodejs_app: full app detail

const GetNodejsAppInput = z.object({
  hosting_id: z.number().int().positive().describe("Node.js hosting id."),
  vhost_route_id: z
    .number()
    .int()
    .positive()
    .describe(
      "The vhost_route_id of the app — get it from `infomaniak_list_nodejs_apps`. Also called `feature_id` in some responses.",
    ),
});

export const getNodejsAppTool = defineTool({
  name: "infomaniak_get_nodejs_app",
  description:
    "Get full configuration of a Node.js application: Node version, listen port, start_command, build_command, public IPs (v4 + v6), SSL status, primary FQDN, preview URL, directory on disk, and disk usage. Manager-private — requires SASESSION + CSRF cookies.",
  inputSchema: GetNodejsAppInput,
  outputSchema: NodejsAppDetailSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof NodejsAppDetailSchema>>(
      "GET",
      `/proxy/1/hostings/${input.hosting_id}/nodejs/${input.vhost_route_id}`,
      { query: { "with[]": "ips,ssl,environments,storage" } },
    );
  },
});

// nodejs_app_status: live status (Running / Stopped)

const NodejsAppStatusInput = z.object({
  hosting_id: z.number().int().positive(),
  vhost_route_id: z.number().int().positive(),
});

const NodejsAppStatusOutput = z.object({
  status: z.string().describe('Live status: "Running" | "Stopped" | other'),
});

export const nodejsAppStatusTool = defineTool({
  name: "infomaniak_nodejs_app_status",
  description:
    "Get the live status of a Node.js application — `Running` or `Stopped`. Cheap call, safe to poll. Manager-private — requires SASESSION + CSRF cookies.",
  inputSchema: NodejsAppStatusInput,
  outputSchema: NodejsAppStatusOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof NodejsAppStatusOutput>>(
      "GET",
      `/proxy/1/hostings/${input.hosting_id}/nodejs/${input.vhost_route_id}/actions/status`,
    );
  },
});

// nodejs_app_aliases: list FQDNs serving the app

const NodejsAppAliasesInput = z.object({
  hosting_id: z.number().int().positive(),
  vhost_route_id: z.number().int().positive(),
});

const NodejsAppAliasesOutput = z.object({
  count: z.number(),
  aliases: z.array(VhostAliasSchema),
});

export const nodejsAppAliasesTool = defineTool({
  name: "infomaniak_nodejs_app_aliases",
  description:
    "List the FQDNs (domain names) serving a Node.js application. Returns the primary FQDN plus the automatic preview URL (xxx.preview.hosting-ik.com). Manager-private.",
  inputSchema: NodejsAppAliasesInput,
  outputSchema: NodejsAppAliasesOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const raw = await client.request<z.infer<typeof VhostAliasSchema>[]>(
      "GET",
      `/proxy/1/hostings/${input.hosting_id}/vhost_route/${input.vhost_route_id}/aliases`,
      { query: { page: 1, per_page: 100, "with[]": "domain_options" } },
    );
    return { count: raw.length, aliases: raw };
  },
});

// nodejs_app_jobs: list recent jobs (build, restart, ...)

const NodejsAppJobsInput = z.object({
  hosting_id: z.number().int().positive(),
  vhost_route_id: z.number().int().positive(),
});

const NodejsAppJobsOutput = z.object({
  jobs: z.array(NodejsJobSchema),
  total: z.number(),
});

export const nodejsAppJobsTool = defineTool({
  name: "infomaniak_nodejs_app_jobs",
  description:
    "List the recent jobs that ran for a Node.js app (builds, restarts, etc.) with their status and a JWT-protected log_stream endpoint per job. Manager-private.",
  inputSchema: NodejsAppJobsInput,
  outputSchema: NodejsAppJobsOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const jobs = await client.request<z.infer<typeof NodejsJobSchema>[]>(
      "GET",
      `/proxy/1/hostings/${input.hosting_id}/nodejs/${input.vhost_route_id}/jobs`,
    );
    return { jobs, total: jobs.length };
  },
});

// nodejs_app_logs: get a JWT + URL to consume the live log stream

const NodejsAppLogsInput = z.object({
  hosting_id: z.number().int().positive(),
  vhost_route_id: z.number().int().positive(),
});

const NodejsAppLogsOutput = z.object({
  endpoint: z
    .string()
    .describe(
      "URL of the live log stream — Server-Sent Events on manager-logs-01.hosting-ik.com.",
    ),
  jwt_token: z
    .string()
    .describe(
      "Short-lived bearer JWT (~1h) — pass as `Authorization: Bearer <token>` when connecting to the endpoint.",
    ),
  expires_at_iso: z
    .string()
    .describe(
      "ISO timestamp of JWT expiry, decoded from the token's `exp` claim.",
    ),
  consumer_hint: z
    .string()
    .describe(
      "Suggested consumer: `curl -N -H 'Authorization: Bearer <jwt>' <endpoint>` or an EventSource with a custom header.",
    ),
});

export const nodejsAppLogsTool = defineTool({
  name: "infomaniak_nodejs_app_logs",
  description:
    "Get credentials to consume the LIVE stdout/stderr stream of a Node.js application. Returns a one-shot JWT (valid ~1h) and the endpoint URL on `manager-logs-01.hosting-ik.com`. The stream itself is Server-Sent Events: consume with `curl -N -H 'Authorization: Bearer <jwt>' <endpoint>`. To fetch a single snapshot, kill the curl after a few lines. Manager-private.",
  inputSchema: NodejsAppLogsInput,
  outputSchema: NodejsAppLogsOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    const raw = await client.request<{ endpoint: string; jwt_token: string }>(
      "GET",
      `/proxy/1/hostings/${input.hosting_id}/webapp/${input.vhost_route_id}/stream`,
    );
    let expiresAt = "unknown";
    try {
      const parts = raw.jwt_token.split(".");
      const payloadB64 = parts[1];
      if (payloadB64 !== undefined) {
        const payload = JSON.parse(
          Buffer.from(payloadB64, "base64").toString("utf8"),
        ) as Record<string, unknown>;
        if (typeof payload["exp"] === "number") {
          expiresAt = new Date(payload["exp"] * 1000).toISOString();
        }
      }
    } catch {
      // Keep unknown status on probe failures.
    }
    return {
      endpoint: raw.endpoint,
      jwt_token: raw.jwt_token,
      expires_at_iso: expiresAt,
      consumer_hint: `curl -N -H 'Authorization: Bearer ${raw.jwt_token.slice(0, 12)}...' ${raw.endpoint}`,
    };
  },
});

// nodejs_app_thumbnail: screenshot of the served site (base64 JPEG)

const NodejsAppThumbnailInput = z.object({
  hosting_id: z.number().int().positive(),
  vhost_route_id: z.number().int().positive(),
  refresh: z
    .boolean()
    .default(false)
    .describe(
      "Ask the manager to re-screenshot the page (slower). Default false (cached).",
    ),
});

const NodejsAppThumbnailOutput = z.object({
  blob: z
    .string()
    .describe(
      "Data URL (data:image/jpeg;base64,...) ready to embed in markdown.",
    ),
});

export const nodejsAppThumbnailTool = defineTool({
  name: "infomaniak_nodejs_app_thumbnail",
  description:
    "Get a screenshot of the running Node.js app as a base64 JPEG data URL. Useful to visually confirm the app is alive without HTTP-probing. Set `refresh=true` to force a fresh screenshot. Manager-private.",
  inputSchema: NodejsAppThumbnailInput,
  outputSchema: NodejsAppThumbnailOutput,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const client = new ManagerApiClient();
    return await client.request<z.infer<typeof NodejsAppThumbnailOutput>>(
      "GET",
      `/proxy/1/hostings/${input.hosting_id}/webapp/${input.vhost_route_id}/thumbnail`,
      { query: { refresh: input.refresh } },
    );
  },
});

// nodejs_app_action: start / stop / restart / build (two-phase commit)

const NodejsAppActionInput = z.object({
  hosting_id: z.number().int().positive(),
  vhost_route_id: z.number().int().positive(),
  action: z
    .enum(["start", "stop", "restart", "build"])
    .describe(
      [
        "`start`  — start a Stopped app",
        "`stop`   — stop a Running app (causes downtime until next start/restart!)",
        "`restart` — gracefully restart the app (a few seconds of downtime)",
        "`build`  — trigger a build job (runs `build_command` + relaunches the app); returns a `resource_id` + log_stream",
      ].join("; "),
    ),
  confirmation_token: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Token from the prior plan response. Required on the apply phase.",
    ),
});

const NodejsAppActionOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      hosting_id: z.number(),
      vhost_route_id: z.number(),
      action: z.string(),
      app_fqdn: z.string().optional(),
      app_status_before: z.string().optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("applied"),
    action: z.string(),
    result_status: z
      .string()
      .describe('Status after the action (e.g. "Running", "Stopped").'),
    resource_id: z
      .string()
      .optional()
      .describe(
        "Only for `build` — id of the spawned build job, also used as log stream id.",
      ),
    log_stream: z
      .object({
        endpoint: z.string(),
        jwt_token: z.string(),
      })
      .optional()
      .describe(
        "Only for `build` — credentials to tail the build output live.",
      ),
  }),
]);

export const nodejsAppActionTool = defineTool({
  name: "infomaniak_nodejs_app_action",
  description:
    "Start, stop, restart, or build a Node.js application. Two-phase commit: first call returns a plan + token, second call (with the token + same args) applies. `stop` causes downtime until next start. `build` triggers a build job and returns its log_stream so you can tail the output. Manager-private.",
  inputSchema: NodejsAppActionInput,
  outputSchema: NodejsAppActionOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const fingerprint = JSON.stringify({
      tool: "infomaniak_nodejs_app_action",
      hosting_id: input.hosting_id,
      vhost_route_id: input.vhost_route_id,
      action: input.action,
    });
    const client = new ManagerApiClient();

    if (!input.confirmation_token) {
      // Plan with current app state.
      let appFqdn: string | undefined;
      let statusBefore: string | undefined;
      try {
        const app = await client.request<{ main_fqdn: string }>(
          "GET",
          `/proxy/1/hostings/${input.hosting_id}/nodejs/${input.vhost_route_id}`,
        );
        appFqdn = app.main_fqdn;
      } catch {
        // Continue without alias preview.
      }
      try {
        const status = await client.request<{ status: string }>(
          "GET",
          `/proxy/1/hostings/${input.hosting_id}/nodejs/${input.vhost_route_id}/actions/status`,
        );
        statusBefore = status.status;
      } catch {
        // Continue without job preview.
      }
      const { token, expiresAt } = mintConfirmationToken(fingerprint);

      const consequence =
        input.action === "stop"
          ? "⚠️  The app will stop serving traffic immediately and remain unreachable until `start` or `restart`."
          : input.action === "restart"
            ? "A few seconds of downtime while the process restarts."
            : input.action === "build"
              ? "Triggers a build job (`build_command` will run), then automatically restarts the app."
              : "Starts a stopped app. No effect if already Running.";

      return {
        status: "plan" as const,
        plan: {
          hosting_id: input.hosting_id,
          vhost_route_id: input.vhost_route_id,
          action: input.action,
          ...(appFqdn !== undefined && { app_fqdn: appFqdn }),
          ...(statusBefore !== undefined && {
            app_status_before: statusBefore,
          }),
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — Node.js app ${input.action}`,
          ``,
          `- **Hosting**: ${input.hosting_id}`,
          `- **App (vhost_route_id)**: ${input.vhost_route_id}`,
          ...(appFqdn ? [`- **FQDN**: \`${appFqdn}\``] : []),
          ...(statusBefore ? [`- **Current status**: ${statusBefore}`] : []),
          `- **Action**: \`${input.action}\``,
          ``,
          consequence,
          ``,
          `To apply: call this tool again with the same arguments + \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    // Apply the requested app action.
    consumeConfirmationToken(input.confirmation_token, fingerprint);

    const data = await client.request<{
      status?: string;
      resource_id?: string;
      log_stream?: { endpoint: string; jwt_token: string };
    }>(
      "POST",
      `/proxy/1/hostings/${input.hosting_id}/nodejs/${input.vhost_route_id}/actions/${input.action}`,
      { body: {} },
    );

    const undoSpec =
      input.action === "stop"
        ? {
            tool: "infomaniak_nodejs_app_action",
            params: {
              hosting_id: input.hosting_id,
              vhost_route_id: input.vhost_route_id,
              action: "start" as const,
            },
            description: `Start the Node.js app that was just stopped (hosting ${input.hosting_id}, vhost ${input.vhost_route_id}).`,
          }
        : undefined;

    recordHistory({
      tool: "infomaniak_nodejs_app_action",
      kind: "nodejs_app_action",
      summary: `Node.js \`${input.action}\` on hosting ${input.hosting_id} vhost_route ${input.vhost_route_id}${data.status ? ` → ${data.status}` : ""}${data.resource_id ? ` (job ${data.resource_id})` : ""}`,
      payload: {
        hosting_id: input.hosting_id,
        vhost_route_id: input.vhost_route_id,
        action: input.action,
        result_status: data.status,
        ...(data.resource_id !== undefined && {
          resource_id: data.resource_id,
        }),
      },
      ...(undoSpec !== undefined && { undo: undoSpec }),
    });

    return {
      status: "applied" as const,
      action: input.action,
      result_status: data.status ?? "Unknown",
      ...(data.resource_id !== undefined && { resource_id: data.resource_id }),
      ...(data.log_stream !== undefined && { log_stream: data.log_stream }),
    };
  },
});
