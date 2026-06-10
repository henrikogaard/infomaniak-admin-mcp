import type { ToolCapability, ToolDefinition } from "./types.js";

export interface ToolCapabilityOutput {
  scope: ToolCapability["scope"];
  risk: ToolCapability["risk"];
  confirmation_required: boolean;
}

export function getToolCapability(tool: ToolDefinition): ToolCapabilityOutput {
  const inferred = inferToolCapability(tool);
  return {
    scope: inferred.scope,
    risk: inferred.risk,
    confirmation_required: inferred.confirmationRequired,
  };
}

export function capabilitySortWeight(capability: ToolCapabilityOutput): number {
  const scopeWeight =
    capability.scope === "admin" ? 20 : capability.scope === "mixed" ? 10 : 0;
  const riskWeight =
    capability.risk === "read" ? 3 : capability.risk === "write" ? 2 : 1;
  return scopeWeight + riskWeight;
}

function inferToolCapability(tool: ToolDefinition): ToolCapability {
  if (tool.capability) {
    return tool.capability;
  }

  const risk = inferRisk(tool);
  return {
    scope: inferScope(tool),
    risk,
    confirmationRequired: risk !== "read" && requiresConfirmation(tool),
  };
}

function inferScope(tool: ToolDefinition): ToolCapability["scope"] {
  const text = `${tool.name} ${tool.description}`.toLowerCase();
  if (text.includes("kmeet") || text.includes("kchat")) {
    return "end_user";
  }
  return "admin";
}

function inferRisk(tool: ToolDefinition): ToolCapability["risk"] {
  if (tool.annotations?.destructiveHint === true) {
    return hasDestructiveVerb(tool) ? "destructive" : "write";
  }
  if (tool.annotations?.readOnlyHint === false) {
    return "write";
  }
  return "read";
}

function hasDestructiveVerb(tool: ToolDefinition): boolean {
  const text = `${tool.name} ${tool.description}`.toLowerCase();
  return /\b(delete|remove|cancel|revoke|empty|disable|undo)\b/u.test(text);
}

function requiresConfirmation(tool: ToolDefinition): boolean {
  const text = `${tool.name} ${tool.description}`.toLowerCase();
  return (
    text.includes("two-phase") ||
    text.includes("confirmation") ||
    text.includes("confirmation_token") ||
    text.includes(" plan ") ||
    text.includes("plan + token") ||
    text.includes("commit")
  );
}
