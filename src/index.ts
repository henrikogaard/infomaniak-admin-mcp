#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { loadConfig } from "./config.js";
import { runTool, toolForClient } from "./tool-handler.js";
import { tools } from "./tools/index.js";
import { logger } from "./runtime/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../package.json"), "utf8"),
) as {
  name: string;
  version: string;
};
const PACKAGE_NAME = pkg.name;
const PACKAGE_VERSION = pkg.version;

async function startServer(): Promise<void> {
  loadConfig();

  const server = new Server(
    { name: PACKAGE_NAME, version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: tools.map(toolForClient),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return runTool(tools, request.params.name, request.params.arguments);
  });

  const transportMode = (process.env["MCP_TRANSPORT"] ?? "stdio").toLowerCase();
  if (transportMode === "stdio") {
    const transport = new StdioServerTransport();
    await server.connect(transport as Transport);
    logger.info(
      { tools: tools.length, transport: "stdio" },
      `${PACKAGE_NAME} v${PACKAGE_VERSION} ready`,
    );
    return;
  }

  if (transportMode === "http" || transportMode === "streamable-http") {
    const httpHost = process.env["MCP_HTTP_HOST"] ?? "127.0.0.1";
    const httpPort = Number(process.env["MCP_HTTP_PORT"] ?? "3000");
    const httpPath = withLeadingSlash(process.env["MCP_HTTP_PATH"] ?? "/mcp");
    const stateful =
      process.env["MCP_HTTP_STATELESS"] !== "1" &&
      process.env["MCP_HTTP_STATELESS"] !== "true";

    const transportOptions = stateful
      ? { sessionIdGenerator: () => randomUUID() }
      : {};
    const transport = new StreamableHTTPServerTransport(transportOptions);
    await server.connect(transport as Transport);

    const httpServer = createServer((req, res) => {
      const requestPath = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (requestPath !== httpPath) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }
      void transport.handleRequest(req, res);
    });

    httpServer.listen(httpPort, httpHost);
    logger.info(
      {
        tools: tools.length,
        transport: "streamable-http",
        host: httpHost,
        port: httpPort,
        path: httpPath,
        stateful,
      },
      `${PACKAGE_NAME} v${PACKAGE_VERSION} ready`,
    );
    return;
  }

  throw new Error(`Unknown MCP_TRANSPORT value: ${transportMode}`);
}

function withLeadingSlash(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path;
}

try {
  await startServer();
} catch (err: unknown) {
  logger.fatal({ err }, "Fatal startup error");
  process.exit(1);
}
