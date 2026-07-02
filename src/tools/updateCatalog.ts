import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import { refreshCatalog } from "../lib/refresh.js";
import { updateCatalogInput } from "../schemas.js";
import { jsonResult } from "./helpers.js";

export function registerUpdateCatalog(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "update_catalog",
    {
      title: "Update the M5Stack product catalog",
      description:
        "Re-fetch the product catalog from shop.m5stack.com and the official docs (takes ~15-30s). " +
        "Use when the user asks about very recent products, when a product they mention is not found, " +
        "or when a data_freshness_warning appears. The refreshed snapshot is cached locally for future sessions.",
      inputSchema: updateCatalogInput,
    },
    async (args) => {
      const ageDays = catalog.ageDays();
      if (!args.force && ageDays < 1) {
        return jsonResult({
          refreshed: false,
          message: `Snapshot is less than a day old (${catalog.meta.fetchedAt}); pass force=true to refresh anyway`,
          data_as_of: catalog.meta.fetchedAt,
        });
      }
      try {
        const result = await refreshCatalog(catalog);
        return jsonResult({
          ...result,
          diff: result.diff
            ? {
                ...result.diff,
                // Cap the handle lists so a long-overdue refresh doesn't flood context.
                added: result.diff.added.slice(0, 30),
                removed: result.diff.removed.slice(0, 30),
                newlyEol: result.diff.newlyEol.slice(0, 30),
              }
            : null,
          data_as_of: result.fetchedAt,
        });
      } catch (err) {
        return jsonResult({
          refreshed: false,
          message: `Refresh failed: ${err instanceof Error ? err.message : String(err)}. Serving existing snapshot.`,
          data_as_of: catalog.meta.fetchedAt,
        });
      }
    },
  );
}
