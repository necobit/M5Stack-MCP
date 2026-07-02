import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import { searchProducts, toSummary } from "../lib/search.js";
import { searchProductsInput } from "../schemas.js";
import { jsonResult, withDataAsOf } from "./helpers.js";

export function registerSearchProducts(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "search_products",
    {
      title: "Search M5Stack products",
      description:
        "Search the M5Stack product catalog (~650 current products) by keywords, category, tags or price. " +
        "Use this first when looking for products matching a capability (e.g. 'co2 sensor', 'motor driver', 'lora'). " +
        "Returns compact summaries; use get_product for full details.",
      inputSchema: searchProductsInput,
    },
    async (args) => {
      const { total, results } = searchProducts(catalog.products, {
        query: args.query,
        category: args.category,
        tags: args.tags,
        maxPriceUsd: args.max_price_usd,
        includeEol: args.include_eol,
        inStockOnly: args.in_stock_only,
        limit: args.limit,
      });
      return jsonResult(
        withDataAsOf(catalog, {
          total,
          shown: results.length,
          products: results.map((r) => toSummary(r.product)),
        }),
      );
    },
  );
}
