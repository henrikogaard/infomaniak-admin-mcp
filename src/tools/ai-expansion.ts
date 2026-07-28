import { z } from "zod";

import { PublicApiClient, type QueryValue } from "../infomaniak/client.js";

import { defineTool } from "./types.js";

const AiProductInput = z.object({ product_id: z.number().int().positive() });

const ConsumptionQuerySchema = z.object({
  page: z.number().int().positive().optional(),
  per_page: z.number().int().positive().max(500).optional(),
  return: z.literal("total").optional(),
});

export const getAiConsumptionsTool = defineTool({
  name: "infomaniak_get_ai_consumptions",
  description:
    "Read usage/consumption records for an Infomaniak AI product, including pagination metadata when available.",
  inputSchema: AiProductInput.extend({ query: ConsumptionQuerySchema.optional() }),
  outputSchema: z.object({ product_id: z.number(), data: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    product_id: input.product_id,
    data: await new PublicApiClient().request<unknown>(
      "GET",
      `/1/ai/${input.product_id}/consumptions`,
      { query: cleanQuery(input.query) },
    ),
  }),
});

export const getAiBatchResultTool = defineTool({
  name: "infomaniak_get_ai_batch_result",
  description: "Read or download the result of an asynchronous Infomaniak AI model batch.",
  inputSchema: AiProductInput.extend({
    batch_id: z.string().min(1),
    download: z.boolean().default(false),
  }),
  outputSchema: z.object({ product_id: z.number(), batch_id: z.string(), download: z.boolean(), data: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    product_id: input.product_id,
    batch_id: input.batch_id,
    download: input.download,
    data: await new PublicApiClient().request<unknown>(
      "GET",
      `/1/ai/${input.product_id}/results/${encodeURIComponent(input.batch_id)}${input.download ? "/download" : ""}`,
    ),
  }),
});

export const listAiProductModelsTool = defineTool({
  name: "infomaniak_list_ai_product_models",
  description: "List the models exposed by one Infomaniak AI product through its OpenAI-compatible v2 endpoint.",
  inputSchema: AiProductInput,
  outputSchema: z.object({ product_id: z.number(), models: z.unknown() }),
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  capability: { scope: "admin", risk: "read", confirmationRequired: false },
  handler: async (input) => ({
    product_id: input.product_id,
    models: await new PublicApiClient().request<unknown>(
      "GET",
      `/2/ai/${input.product_id}/openai/v1/models`,
    ),
  }),
});

function cleanQuery(query: Record<string, unknown> | undefined): Record<string, QueryValue> {
  const result: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}
