import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import {
  consumeConfirmationToken,
  mintConfirmationToken,
} from "../runtime/confirmation-store.js";

import { defineTool } from "./types.js";

const HttpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const PathSchema = z
  .string()
  .min(2)
  .startsWith("/", "path must begin with '/'")
  .regex(
    /^\/\d+\/[A-Za-z0-9_/.{}-]+$/,
    "path must look like /<version>/<route>, e.g. '/1/profile' or '/2/zones/example.com/records'",
  );

const ApiCallInput = z.object({
  method: HttpMethodSchema,
  path: PathSchema,
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  confirmation_token: z.string().uuid().optional(),
});

const ApiCallOutput = z.union([
  z.object({
    status: z.literal("plan"),
    plan: z.object({
      method: HttpMethodSchema,
      path: z.string(),
      query: z.record(z.unknown()).optional(),
      body: z.unknown().optional(),
    }),
    confirmation_token: z.string(),
    token_expires_at: z.string(),
    next_step_markdown: z.string(),
  }),
  z.object({
    status: z.literal("executed"),
    method: HttpMethodSchema,
    path: z.string(),
    response: z.unknown(),
  }),
]);

export const apiCallTool = defineTool({
  name: "infomaniak_api_call",
  description:
    "Escape hatch: call ANY Infomaniak public API endpoint (api.infomaniak.com) when no dedicated tool exists. GET runs immediately. POST/PUT/PATCH/DELETE follow the two-phase commit pattern. Manager-private (/proxy/...) endpoints are NOT reachable through this tool — use a typed tool instead.",
  inputSchema: ApiCallInput,
  outputSchema: ApiCallOutput,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  },
  handler: async (input) => {
    const isReadOnly = input.method === "GET";
    const fingerprint = JSON.stringify({
      tool: "infomaniak_api_call",
      method: input.method,
      path: input.path,
      query: input.query ?? null,
      body: input.body ?? null,
    });

    // Plan write calls before they run.
    if (!isReadOnly && !input.confirmation_token) {
      const { token, expiresAt } = mintConfirmationToken(fingerprint);
      return {
        status: "plan" as const,
        plan: {
          method: input.method,
          path: input.path,
          ...(input.query !== undefined ? { query: input.query } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
        },
        confirmation_token: token,
        token_expires_at: expiresAt.toISOString(),
        next_step_markdown: [
          `## Plan — direct API call`,
          ``,
          `- **Method**: ${input.method}`,
          `- **Path**: \`${input.path}\``,
          ...(input.query
            ? [`- **Query**: \`${JSON.stringify(input.query)}\``]
            : []),
          ...(input.body !== undefined
            ? [`- **Body**: \`${JSON.stringify(input.body).slice(0, 200)}\``]
            : []),
          ``,
          `### ⚠️ This is an unstructured destructive call`,
          `Server-side validation will reject malformed payloads. Re-check the docs at https://developer.infomaniak.com/docs/api before confirming.`,
          ``,
          `### Next step`,
          `Re-call \`infomaniak_api_call\` with the same parameters AND \`confirmation_token: "${token}"\`.`,
        ].join("\n"),
      };
    }

    // Reads run now; writes run after confirmation.
    if (!isReadOnly) {
      if (!input.confirmation_token) {
        throw new Error(
          "Internal logic error: non-GET method reached apply path without token.",
        );
      }
      if (!consumeConfirmationToken(input.confirmation_token, fingerprint)) {
        throw new Error(
          "Confirmation token is invalid, expired, or doesn't match the parameters.",
        );
      }
    }
    const client = new PublicApiClient();
    const response = await client.request<unknown>(input.method, input.path, {
      ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });
    return {
      status: "executed" as const,
      method: input.method,
      path: input.path,
      response,
    };
  },
});
