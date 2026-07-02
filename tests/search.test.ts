import { describe, expect, it } from "vitest";
import { searchProducts } from "../src/lib/search.js";
import type { NormalizedProduct } from "../src/data/types.js";

function product(overrides: Partial<NormalizedProduct>): NormalizedProduct {
  return {
    handle: overrides.title?.toLowerCase().replace(/\s+/g, "-") ?? "p",
    shopifyId: 1,
    title: "P",
    eol: false,
    sku: null,
    category: "unit",
    formFactor: "UNIT",
    subcategories: [],
    tags: [],
    descriptionText: "",
    variants: [{ sku: null, title: "Default", price: "10.00", available: true }],
    priceRange: { min: 10, max: 10, currency: "USD" },
    imageUrl: null,
    url: "",
    docs: null,
    connectivity: { grove: [], interfaces: [], i2cAddress: null, source: "unknown" },
    ...overrides,
  };
}

const catalog = [
  product({
    title: "CO2 Unit SCD40",
    docs: { category: "Sensors", docUrl: "", quickstartUrl: null, keywords: ["SCD40", "CO2"], matchType: "exact-sku" },
  }),
  product({ title: "Relay Unit", descriptionText: "switch AC loads" }),
  product({ title: "Old CO2 Sensor", eol: true }),
  product({ title: "Pricey CO2 Analyzer", priceRange: { min: 99, max: 99, currency: "USD" } }),
];

describe("searchProducts", () => {
  it("keyword hit in docs keywords outranks description hit", () => {
    const { results } = searchProducts(catalog, { query: "co2" });
    expect(results[0].product.title).toBe("CO2 Unit SCD40");
  });

  it("excludes EOL by default, includes on demand", () => {
    expect(searchProducts(catalog, { query: "co2" }).results.map((r) => r.product.title)).not.toContain("Old CO2 Sensor");
    expect(searchProducts(catalog, { query: "co2", includeEol: true }).results.map((r) => r.product.title)).toContain(
      "Old CO2 Sensor",
    );
  });

  it("applies price ceiling", () => {
    const { results } = searchProducts(catalog, { query: "co2", maxPriceUsd: 50 });
    expect(results.map((r) => r.product.title)).not.toContain("Pricey CO2 Analyzer");
  });

  it("non-matching query returns nothing", () => {
    expect(searchProducts(catalog, { query: "zigbee thermostat" }).total).toBe(0);
  });
});
