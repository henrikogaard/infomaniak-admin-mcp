import type { z } from "zod";

export interface ToolAnnotations {
  readOnlyHint?: boolean | undefined;
  destructiveHint?: boolean | undefined;
  idempotentHint?: boolean | undefined;
  openWorldHint?: boolean | undefined;
}

export interface ToolCapability {
  scope: "admin" | "end_user" | "mixed";
  risk: "read" | "write" | "destructive";
  confirmationRequired: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: z.ZodTypeAny;
  outputSchema?: z.ZodTypeAny | undefined;
  annotations?: ToolAnnotations | undefined;
  capability?: ToolCapability | undefined;
  handler: (input: unknown) => Promise<unknown>;
}

export function defineTool<
  TInput extends z.ZodTypeAny,
  TOutput extends z.ZodTypeAny,
>(definition: {
  name: string;
  description: string;
  inputSchema: TInput;
  outputSchema?: TOutput;
  annotations?: ToolAnnotations;
  capability?: ToolCapability;
  handler: (
    input: z.infer<TInput>,
  ) => Promise<z.infer<TOutput>> | Promise<unknown>;
}): ToolDefinition {
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    annotations: definition.annotations,
    capability: definition.capability,
    handler: async (input: unknown) =>
      (definition.handler as (i: unknown) => Promise<unknown>)(input),
  };
}
