import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import { listCategoriesInput } from "../schemas.js";
import { jsonResult, withDataAsOf } from "./helpers.js";

export function registerListCategories(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "list_categories",
    {
      title: "List M5Stack product categories",
      description:
        "List the normalized M5Stack product category tree with product counts. " +
        "Useful to understand the lineup structure (controllers, units, modules, hats, ...) before searching.",
      inputSchema: listCategoriesInput,
    },
    async (args) => {
      const categories = args.include_counts
        ? catalog.categories
        : catalog.categories.map(({ category, label }) => ({ category, label }));
      return jsonResult(withDataAsOf(catalog, { categories }));
    },
  );
}
