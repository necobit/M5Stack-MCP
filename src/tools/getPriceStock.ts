import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import { fetchLiveProduct } from "../lib/shopify.js";
import { getPriceStockInput } from "../schemas.js";
import { jsonResult, withDataAsOf } from "./helpers.js";

export function registerGetPriceStock(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "get_price_stock",
    {
      title: "Get current price and stock",
      description:
        "Fetch current price and stock availability for up to 10 M5Stack products live from shop.m5stack.com. " +
        "Use when the user asks about buying, availability or current prices. " +
        "Falls back to snapshot values when the live fetch fails.",
      inputSchema: getPriceStockInput,
    },
    async (args) => {
      const items = [];
      const errors = [];
      for (const identifier of args.identifiers) {
        const product = catalog.resolve(identifier);
        if (!product) {
          errors.push({ identifier, reason: "not found in catalog" });
          continue;
        }
        const live = await fetchLiveProduct(product.handle);
        if (live) {
          items.push({
            handle: product.handle,
            title: product.title,
            eol: product.eol,
            source: "live" as const,
            variants: live.variants,
            fetched_at: live.fetchedAt,
          });
        } else {
          items.push({
            handle: product.handle,
            title: product.title,
            eol: product.eol,
            source: "snapshot-fallback" as const,
            variants: product.variants,
            fetched_at: catalog.meta.fetchedAt,
          });
        }
      }
      return jsonResult(withDataAsOf(catalog, { items, errors }));
    },
  );
}
