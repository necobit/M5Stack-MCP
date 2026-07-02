import { z } from "zod";

export const CategoryEnum = z.enum([
  "controller",
  "unit",
  "module",
  "hat",
  "atomic-base",
  "stamp-accessory",
  "kit",
  "accessory",
]);

export const searchProductsInput = {
  query: z
    .string()
    .optional()
    .describe("Search keywords, English recommended (e.g. 'temperature humidity sensor', 'relay', 'lora')"),
  category: CategoryEnum.optional().describe("Filter by normalized category"),
  tags: z.array(z.string()).optional().describe("Filter by shop tags (all must match, substring ok)"),
  max_price_usd: z.number().positive().optional().describe("Only products at or below this price (USD)"),
  include_eol: z
    .boolean()
    .default(false)
    .describe("Include end-of-life (discontinued) products. Default false"),
  in_stock_only: z.boolean().default(false).describe("Only products in stock as of the data snapshot"),
  limit: z.number().int().min(1).max(50).default(20),
};

export const getProductInput = {
  identifier: z
    .string()
    .describe("Product handle (e.g. 'atom-lite-esp32-development-kit') or SKU (e.g. 'C008', 'U001-D')"),
  include_live_price: z
    .boolean()
    .default(false)
    .describe("Fetch current price and stock from shop.m5stack.com (slower)"),
};

export const listCategoriesInput = {
  include_counts: z.boolean().default(true),
};

export const checkCompatibilityInput = {
  controller: z.string().describe("Controller handle or SKU (e.g. 'm5stack-cores3-esp32s3-iotdevelopment-kit', 'K128')"),
  peripherals: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Peripheral handles or SKUs to check against the controller"),
};

export const suggestConfigurationInput = {
  use_case: z
    .string()
    .describe("Free-form description of what you want to build. Including English keywords improves matching"),
  requirements: z
    .array(z.string())
    .optional()
    .describe("Explicit capability keywords, e.g. ['temperature sensor', 'wifi', 'display', 'battery']"),
  budget_usd: z.number().positive().optional().describe("Total budget in USD"),
  preferred_form: z
    .enum(["CORE", "ATOM", "STICKC", "STAMP", "any"])
    .default("any")
    .describe("Preferred controller family. CORE=display+battery, ATOM=tiny, STICKC=small with display, STAMP=embeddable"),
  include_eol: z.boolean().default(false),
};

export const getPriceStockInput = {
  identifiers: z.array(z.string()).min(1).max(10).describe("Product handles or SKUs (max 10)"),
};
