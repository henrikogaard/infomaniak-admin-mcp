import { z } from "zod";

import { PublicApiClient } from "../infomaniak/client.js";
import { defaultAccountId } from "../runtime/account-cache.js";

import { defineTool } from "./types.js";

const SwissBackupSchema = z
  .object({
    id: z.number(),
    customer_name: z.string().optional(),
    description: z.string().nullable().optional(),
    has_maintenance: z.boolean().optional(),
  })
  .passthrough();

const ListInput = z.object({
  account_id: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Organization/account ID. Optional: defaults to the first account the token has access to. Discover via infomaniak_overview.",
    ),
});

const ListOutput = z.object({
  account_id: z.number(),
  count: z.number(),
  swiss_backups: z.array(SwissBackupSchema),
});

export const listSwissBackupsTool = defineTool({
  name: "infomaniak_list_swiss_backups",
  description:
    "List Swiss Backup subscriptions on an Infomaniak organization (Acronis-based managed backup).",
  inputSchema: ListInput,
  outputSchema: ListOutput,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: true,
  },
  handler: async (input) => {
    const accountId = input.account_id ?? (await defaultAccountId());
    if (accountId === null) {
      throw new Error(
        "No account_id provided and the token reaches no accounts. Use infomaniak_overview to list available accounts.",
      );
    }
    const client = new PublicApiClient();
    const data = await client.request<Array<unknown>>(
      "GET",
      "/1/swiss_backups",
      {
        query: { account_id: accountId },
      },
    );
    return {
      account_id: accountId,
      count: data.length,
      swiss_backups: data.map((b) => SwissBackupSchema.parse(b)),
    };
  },
});
