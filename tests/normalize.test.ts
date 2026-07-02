import { describe, expect, it } from "vitest";
import {
  buildDocsIndexes,
  extractConnectivity,
  htmlToText,
  matchDocs,
  normalizeProduct,
  type DocsEntry,
  type ShopifyProduct,
} from "../src/lib/normalize.js";

function shopify(overrides: Partial<ShopifyProduct> = {}): ShopifyProduct {
  return {
    id: 1,
    title: "Test Unit",
    handle: "test-unit",
    body_html: "<p>Description</p><p>A Grove sensor using I2C (0x44) on Port A.</p>",
    tags: ["UNIT"],
    variants: [{ sku: "U999", title: "Default Title", price: "9.95", available: true }],
    images: [{ src: "https://example.com/img.png" }],
    ...overrides,
  };
}

describe("htmlToText", () => {
  it("strips tags, entities and the Description heading", () => {
    const text = htmlToText("<h3>Description</h3><p>Hello &amp; world</p><script>x()</script>");
    expect(text).toBe("Hello & world");
  });
});

describe("EOL detection", () => {
  it("flags [EOL] titles and strips the prefix", () => {
    const p = normalizeProduct(shopify({ title: "[EOL] Old Unit" }), ["unit"], null, undefined);
    expect(p.eol).toBe(true);
    expect(p.title).toBe("Old Unit");
  });

  it("does not flag in-stock products without the prefix", () => {
    const p = normalizeProduct(shopify(), ["unit"], null, undefined);
    expect(p.eol).toBe(false);
  });
});

describe("category derivation", () => {
  it("controllers collection wins", () => {
    const p = normalizeProduct(shopify({ title: "Some Core" }), ["controllers"], null, undefined);
    expect(p.category).toBe("controller");
    expect(p.formFactor).toBe("CORE_HOST");
  });

  it("unit collection maps to unit", () => {
    const p = normalizeProduct(shopify(), ["unit"], null, undefined);
    expect(p.category).toBe("unit");
    expect(p.formFactor).toBe("UNIT");
  });

  it("for-stick maps to hat", () => {
    const p = normalizeProduct(shopify({ title: "Speaker Hat" }), ["for-stick"], null, undefined);
    expect(p.category).toBe("hat");
    expect(p.formFactor).toBe("HAT");
  });

  it("uncollected products fall back to accessory", () => {
    const p = normalizeProduct(shopify({ title: "Random Cable", tags: [] }), [], null, undefined);
    expect(p.category).toBe("accessory");
  });
});

describe("connectivity extraction", () => {
  it("extracts port letters and i2c address", () => {
    const c = extractConnectivity("Connects via Port A using I2C address 0x44", []);
    expect(c.grove).toEqual(["A"]);
    expect(c.interfaces).toContain("I2C");
    expect(c.i2cAddress).toBe("0x44");
    expect(c.source).toBe("extracted");
  });

  it("bare Grove mention implies Port A", () => {
    const c = extractConnectivity("Grove connector included", []);
    expect(c.grove).toEqual(["A"]);
  });

  it("curated ports override extraction", () => {
    const p = normalizeProduct(shopify(), ["unit"], null, { grove: ["B"] });
    expect(p.connectivity.grove).toEqual(["B"]);
    expect(p.connectivity.source).toBe("curated");
  });
});

describe("docs matching", () => {
  const entries: DocsEntry[] = [
    { p: "TEST UNIT", sku: "U999", category: "Sensors", a: "https://docs.m5stack.com/#/en/unit/test" },
    { p: "ENV", sku: "U001", category: "Sensors", a: "https://docs.m5stack.com/#/en/unit/env" },
  ];
  const { docsBySku, docsByTitle } = buildDocsIndexes(entries);

  it("exact sku match", () => {
    const m = matchDocs(shopify(), docsBySku, docsByTitle);
    expect(m?.matchType).toBe("exact-sku");
  });

  it("prefix sku match for colour variants", () => {
    const m = matchDocs(
      shopify({ variants: [{ sku: "U001-D", title: "x", price: "1", available: true }] }),
      docsBySku,
      docsByTitle,
    );
    expect(m?.matchType).toBe("prefix-sku");
    expect(m?.entry.sku).toBe("U001");
  });

  it("title match as last resort", () => {
    const m = matchDocs(
      shopify({ variants: [{ sku: "ZZZZ", title: "x", price: "1", available: true }], title: "Test Unit!" }),
      docsBySku,
      docsByTitle,
    );
    expect(m?.matchType).toBe("title");
  });

  it("no match returns null", () => {
    const m = matchDocs(
      shopify({ variants: [{ sku: "ZZZZ", title: "x", price: "1", available: true }], title: "Unrelated" }),
      docsBySku,
      docsByTitle,
    );
    expect(m).toBeNull();
  });
});
