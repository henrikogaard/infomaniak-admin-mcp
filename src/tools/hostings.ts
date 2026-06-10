import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { ProductSchema } from "../schemas/infomaniak.js";
import { defaultAccountId } from "../runtime/account-cache.js";

import { defineTool } from "./types.js";

const InputSchema = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Organization/account ID. Optional: if omitted, falls back to the first account the token has access to. Use infomaniak_overview to enumerate.",
    ),
  include_nodejs: z.boolean().default(true),
});

const HostingSchema = ProductSchema.extend({
  is_nodejs: z.boolean(),
});

const OutputSchema = z.object({
  account_id: z.number(),
  hostings: z.array(HostingSchema),
});

export const listHostingsTool = defineTool({
  name: "infomaniak_list_hostings",
  description:
    "Lists web hostings (classic + Node.js) for a given Infomaniak organization. Use infomaniak_list_organizations first to discover account IDs.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const accountId = input.account_id ?? (await defaultAccountId());
    if (accountId === null) {
      throw new Error(
        "No account_id provided and the API token has no reachable accounts. Try `infomaniak_overview` or provide account_id explicitly.",
      );
    }
    const client = new PublicApiClient();
    const products = await client.request<Array<unknown>>(
      "GET",
      "/1/products",
      {
        query: { per_page: 500, account_id: accountId },
      },
    );
    const allowed = new Set(
      input.include_nodejs ? ["hosting", "hosting_3"] : ["hosting"],
    );
    const hostings = products
      .map((p) => ProductSchema.parse(p))
      .filter((p) => p.account_id === accountId && allowed.has(p.service_name))
      .map((p) => ({ ...p, is_nodejs: p.service_name === "hosting_3" }));
    return { account_id: accountId, hostings };
  },
});
