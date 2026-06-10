import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { InfomaniakError } from "./infomaniak/errors.js";
import type { ToolDefinition } from "./tools/types.js";
import { auditToolExecution } from "./runtime/audit-log.js";
import { logger } from "./runtime/logger.js";

export type ToolResult = CallToolResult;

export function toolForClient(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: toJsonSchema(tool.inputSchema),
    ...(tool.outputSchema
      ? { outputSchema: toJsonSchema(tool.outputSchema) }
      : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  };
}

export async function runTool(
  registry: ReadonlyArray<ToolDefinition>,
  name: string,
  args: unknown,
): Promise<ToolResult> {
  const tool = registry.find((candidate) => candidate.name === name);

  if (!tool) {
    return errorResult(`Unknown tool: ${name}`);
  }

  try {
    const parsed = tool.inputSchema.parse(args ?? {});
    const result = await auditToolExecution(tool, parsed, () =>
      tool.handler(parsed),
    );

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result as Record<string, unknown>,
    };
  } catch (err) {
    if (err instanceof InfomaniakError) {
      return err.toToolError();
    }

    logger.error({ err, tool: tool.name }, "Tool handler error");
    return errorResult(
      `❌ ${err instanceof Error ? err.message : "Unknown error"}`,
    );
  }
}

function toJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const jsonSchema = {
    ...(zodToJsonSchema(schema, { target: "jsonSchema7" }) as Record<
      string,
      unknown
    >),
  };

  delete jsonSchema["$schema"];

  if (!("type" in jsonSchema) && "anyOf" in jsonSchema) {
    return { type: "object", ...jsonSchema };
  }

  return jsonSchema;
}

function errorResult(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}
