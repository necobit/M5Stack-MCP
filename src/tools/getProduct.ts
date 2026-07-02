import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import { fetchLiveProduct } from "../lib/shopify.js";
import { getProductInput } from "../schemas.js";
import { jsonResult, resolveOrError, withDataAsOf } from "./helpers.js";

export function registerGetProduct(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "get_product",
    {
      title: "Get M5Stack product details",
      description:
        "Get full details of one M5Stack product by handle or SKU: specs description, variants, " +
        "connectivity (Grove ports, interfaces), documentation links and EOL status. " +
        "Set include_live_price=true only when current price/stock matters.",
      inputSchema: getProductInput,
    },
    async (args) => {
      const resolved = resolveOrError(catalog, args.identifier);
      if ("error" in resolved) return jsonResult(withDataAsOf(catalog, resolved));

      const product = resolved.product;
      let live = null;
      let liveError: string | undefined;
      if (args.include_live_price) {
        live = await fetchLiveProduct(product.handle);
        if (!live) liveError = "Live fetch failed; snapshot values shown in `variants` may be stale.";
      }
      return jsonResult(withDataAsOf(catalog, { product, live, ...(liveError ? { liveError } : {}) }));
    },
  );
}
