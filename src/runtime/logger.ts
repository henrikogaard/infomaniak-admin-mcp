import pino from "pino";

import { loadConfig } from "../config.js";

const config = loadConfig();

const REDACT_PATHS = [
  "token",
  "access_token",
  "refresh_token",
  "Authorization",
  "authorization",
  "Cookie",
  "cookie",
  "SASESSION",
  "X-XSRF-TOKEN",
  "MANAGER-XSRF-TOKEN",
  "password",
  "secret",
  "client_secret",
  "*.token",
  "*.access_token",
  "*.refresh_token",
  "*.password",
];

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(2), // stderr
);

export function childLogger(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
