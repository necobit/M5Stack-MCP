#!/usr/bin/env node
// stdio MCP server entry point. stdout carries the MCP protocol —
// all logging must go to stderr (console.error).

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadCatalog } from "./data/loader.js";
import { refreshCatalog } from "./lib/refresh.js";
import { createServer } from "./server.js";

// Auto-refresh the snapshot in the background when it has grown stale, so
// installed copies keep up with M5Stack's weekly releases without a git pull.
// Disable with M5STACK_MCP_AUTO_UPDATE=0.
const AUTO_REFRESH_AFTER_DAYS = 7;

function maybeAutoRefresh(): void {
  if (process.env.M5STACK_MCP_AUTO_UPDATE === "0") return;
  const catalog = loadCatalog();
  const age = catalog.ageDays();
  if (age < AUTO_REFRESH_AFTER_DAYS) return;
  console.error(`m5stack-mcp: snapshot is ${age} days old, refreshing in background`);
  refreshCatalog(catalog)
    .then((r) => console.error(`m5stack-mcp: ${r.message}`))
    .catch((err) => console.error(`m5stack-mcp: background refresh failed (${err})`));
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("m5stack-mcp server running on stdio");
  maybeAutoRefresh();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
