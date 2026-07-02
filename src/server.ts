import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadCatalog } from "./data/loader.js";
import { registerCheckCompatibility } from "./tools/checkCompatibility.js";
import { registerGetPriceStock } from "./tools/getPriceStock.js";
import { registerGetProduct } from "./tools/getProduct.js";
import { registerListCategories } from "./tools/listCategories.js";
import { registerSearchProducts } from "./tools/searchProducts.js";
import { registerSuggestConfiguration } from "./tools/suggestConfiguration.js";
import { registerUpdateCatalog } from "./tools/updateCatalog.js";

export function createServer(): McpServer {
  const catalog = loadCatalog();

  const server = new McpServer({
    name: "m5stack-mcp",
    version: "0.1.0",
  });

  registerSearchProducts(server, catalog);
  registerGetProduct(server, catalog);
  registerListCategories(server, catalog);
  registerCheckCompatibility(server, catalog);
  registerSuggestConfiguration(server, catalog);
  registerGetPriceStock(server, catalog);
  registerUpdateCatalog(server, catalog);

  return server;
}
