import { z } from "zod";

const BooleanEnvSchema = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0", "yes", "no"])])
  .transform((value) => {
    if (typeof value === "boolean") {
      return value;
    }
    return value === "true" || value === "1" || value === "yes";
  });

const ConfigSchema = z.object({
  INFOMANIAK_API_TOKEN: z
    .string()
    .min(20, "INFOMANIAK_API_TOKEN looks too short"),

  INFOMANIAK_AUTH_MODE: z.enum(["auto", "manual", "disabled"]).default("auto"),

  INFOMANIAK_SASESSION: z.string().optional(),

  INFOMANIAK_XSRF_TOKEN: z.string().optional(),

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
    .default("info"),

  CONFIRMATION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .min(10)
    .max(600)
    .default(60),

  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(60),

  INFOMANIAK_AUDIT_LOG_ENABLED: BooleanEnvSchema.default(true),

  INFOMANIAK_AUDIT_LOG_INCLUDE_READS: BooleanEnvSchema.default(true),

  INFOMANIAK_AUDIT_LOG_PATH: z
    .string()
    .min(1)
    .default("./logs/infomaniak-mcp-audit.jsonl"),
});

export type Config = z.infer<typeof ConfigSchema>;

let cachedConfig: Config | null = null;

export function loadConfig(): Config {
  if (cachedConfig !== null) {
    return cachedConfig;
  }

  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(
      [
        "Invalid runtime configuration — required environment variable(s) missing or malformed:",
        issues,
        "",
        "How to set them:",
        "  • Claude Desktop / Claude Code: add them to the `env` block of your MCP server entry in",
        "    `claude_desktop_config.json` (or `~/.claude.json` for Claude Code).",
        "    See: README.md#configure-claude-desktop in this repository.",
        "  • From a shell: export INFOMANIAK_API_TOKEN=... before running the server.",
        "",
        "Get an API token at: https://manager.infomaniak.com/v3/api-token",
      ].join("\n"),
    );
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}

export function _resetConfigCache(): void {
  cachedConfig = null;
}
