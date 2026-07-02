// Regenerates data/products.json, data/categories.json and data/meta.json
// from shop.m5stack.com (Shopify storefront JSON) and the official
// m5-docs product_list.json. Run with: npm run update-data

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  CategoryNode,
  CompatibilityRules,
  NormalizedProduct,
  SnapshotMeta,
} from "../src/data/types.js";
import { CATEGORY_COLLECTIONS, CATEGORY_LABELS } from "../src/lib/categories.js";
import {
  buildDocsIndexes,
  matchDocs,
  normalizeProduct,
  type DocsEntry,
  type ShopifyProduct,
} from "../src/lib/normalize.js";

const SHOP = "https://shop.m5stack.com";
const DOCS_PRODUCT_LIST =
  "https://raw.githubusercontent.com/m5stack/m5-docs/master/docs/en/product_list.json";
const USER_AGENT = "m5stack-mcp-updater/0.1 (+https://github.com/necobit/M5Stack-MCP)";
const REQUEST_INTERVAL_MS = 500;
const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const backoff = 1000 * 2 ** attempt;
      console.error(`HTTP ${res.status} for ${url}, retrying in ${backoff}ms`);
      await sleep(backoff);
      continue;
    }
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
}

const ShopifyProductSchema = z.object({
  id: z.number(),
  title: z.string(),
  handle: z.string(),
  body_html: z.string().nullable(),
  tags: z.array(z.string()),
  variants: z.array(
    z.object({
      sku: z.string().nullable(),
      title: z.string(),
      price: z.string(),
      available: z.boolean(),
    }),
  ),
  images: z.array(z.object({ src: z.string() })),
});

const DocsEntrySchema = z.object({
  p: z.string().default(""),
  sku: z.string().default(""),
  category: z.string().default(""),
  a: z.string().default(""),
  qs: z.string().optional(),
  img: z.string().optional(),
  kw: z.union([z.array(z.string()), z.string()]).optional(),
});

async function fetchAllProducts(): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; ; page++) {
    const data = (await fetchJson(`${SHOP}/products.json?limit=250&page=${page}`)) as {
      products: unknown[];
    };
    if (!data.products?.length) break;
    for (const p of data.products) {
      all.push(ShopifyProductSchema.parse(p));
    }
    console.error(`products page ${page}: ${data.products.length} items (total ${all.length})`);
    await sleep(REQUEST_INTERVAL_MS);
  }
  return all;
}

async function fetchCollectionMembership(): Promise<Map<string, string[]>> {
  const handleToCollections = new Map<string, string[]>();
  for (const collection of CATEGORY_COLLECTIONS) {
    let count = 0;
    for (let page = 1; ; page++) {
      let data: { products?: { handle: string }[] };
      try {
        data = (await fetchJson(
          `${SHOP}/collections/${collection}/products.json?limit=250&page=${page}`,
        )) as { products?: { handle: string }[] };
      } catch (err) {
        console.error(`collection ${collection}: fetch failed (${err}), skipping`);
        break;
      }
      if (!data.products?.length) break;
      for (const p of data.products) {
        const list = handleToCollections.get(p.handle) ?? [];
        list.push(collection);
        handleToCollections.set(p.handle, list);
        count++;
      }
      await sleep(REQUEST_INTERVAL_MS);
    }
    console.error(`collection ${collection}: ${count} products`);
  }
  return handleToCollections;
}

// product_list.json is nested: { "Controllers": { "core": [ {id marker}, {product}, ... ] }, ... }
// Entries with a "p" field are products; "a"/"qs" are paths relative to docs.m5stack.com.
async function fetchDocsEntries(): Promise<DocsEntry[]> {
  const raw = (await fetchJson(DOCS_PRODUCT_LIST)) as Record<string, Record<string, unknown[]>>;
  const entries: DocsEntry[] = [];
  for (const [topCategory, subcategories] of Object.entries(raw)) {
    if (typeof subcategories !== "object" || subcategories === null) continue;
    for (const items of Object.values(subcategories)) {
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const parsed = DocsEntrySchema.safeParse(item);
        if (!parsed.success || !parsed.data.p) continue;
        const e = parsed.data as DocsEntry;
        entries.push({
          ...e,
          category: e.category || topCategory,
          a: e.a ? `https://docs.m5stack.com${e.a}` : "",
          qs: e.qs ? `https://docs.m5stack.com${e.qs}` : undefined,
        });
      }
    }
  }
  return entries;
}

function loadRules(): CompatibilityRules {
  const path = `${DATA_DIR}compatibility-rules.json`;
  return JSON.parse(readFileSync(path, "utf8")) as CompatibilityRules;
}

function buildCategoryTree(products: NormalizedProduct[]): CategoryNode[] {
  const nodes = new Map<string, CategoryNode>();
  for (const [category, label] of Object.entries(CATEGORY_LABELS)) {
    nodes.set(category, {
      category: category as CategoryNode["category"],
      label,
      total: 0,
      eolCount: 0,
      subcategories: [],
    });
  }
  const subCounts = new Map<string, Map<string, number>>();
  for (const p of products) {
    const node = nodes.get(p.category)!;
    node.total++;
    if (p.eol) node.eolCount++;
    const subs = subCounts.get(p.category) ?? new Map<string, number>();
    for (const s of p.subcategories) subs.set(s, (subs.get(s) ?? 0) + 1);
    subCounts.set(p.category, subs);
  }
  for (const [category, subs] of subCounts) {
    nodes.get(category)!.subcategories = [...subs.entries()]
      .map(([handle, count]) => ({ handle, count }))
      .sort((a, b) => b.count - a.count);
  }
  return [...nodes.values()].sort((a, b) => b.total - a.total);
}

function reportDiff(previous: NormalizedProduct[], next: NormalizedProduct[]): void {
  const prevByHandle = new Map(previous.map((p) => [p.handle, p]));
  const nextByHandle = new Map(next.map((p) => [p.handle, p]));

  const added = next.filter((p) => !prevByHandle.has(p.handle));
  const removed = previous.filter((p) => !nextByHandle.has(p.handle));
  const eolTransitions = next.filter((p) => {
    const prev = prevByHandle.get(p.handle);
    return prev && !prev.eol && p.eol;
  });
  const priceChanges = next.filter((p) => {
    const prev = prevByHandle.get(p.handle);
    return prev && (prev.priceRange.min !== p.priceRange.min || prev.priceRange.max !== p.priceRange.max);
  });

  console.error(`--- diff vs previous snapshot ---`);
  console.error(`added: ${added.length}${added.length ? " — " + added.map((p) => p.handle).join(", ") : ""}`);
  console.error(`removed: ${removed.length}${removed.length ? " — " + removed.map((p) => p.handle).join(", ") : ""}`);
  console.error(`newly EOL: ${eolTransitions.length}${eolTransitions.length ? " — " + eolTransitions.map((p) => p.handle).join(", ") : ""}`);
  console.error(`price changed: ${priceChanges.length}`);
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rules = loadRules();

  console.error("fetching shop products...");
  const shopProducts = await fetchAllProducts();
  console.error("fetching collection membership...");
  const membership = await fetchCollectionMembership();
  console.error("fetching docs product list...");
  const docsEntries = await fetchDocsEntries();
  const { docsBySku, docsByTitle } = buildDocsIndexes(docsEntries);

  const matchedDocs = new Set<DocsEntry>();
  const products: NormalizedProduct[] = shopProducts
    .map((raw) => {
      const docsMatch = matchDocs(raw, docsBySku, docsByTitle);
      if (docsMatch) matchedDocs.add(docsMatch.entry);
      const curated =
        rules.portRequirements[raw.handle] ??
        (raw.variants[0]?.sku ? rules.portRequirements[raw.variants[0].sku] : undefined);
      return normalizeProduct(raw, membership.get(raw.handle) ?? [], docsMatch, curated);
    })
    .sort((a, b) => a.handle.localeCompare(b.handle));

  // Safety valve: refuse to overwrite a good snapshot with a drastically smaller one.
  const productsPath = `${DATA_DIR}products.json`;
  let previous: NormalizedProduct[] = [];
  if (existsSync(productsPath)) {
    previous = JSON.parse(readFileSync(productsPath, "utf8")) as NormalizedProduct[];
    if (previous.length > 0 && products.length < previous.length * 0.8) {
      throw new Error(
        `Aborting: new snapshot has ${products.length} products, previous had ${previous.length} (>20% drop)`,
      );
    }
    reportDiff(previous, products);
  }

  const docsMatchedCount = products.filter((p) => p.docs).length;
  const meta: SnapshotMeta = {
    fetchedAt: new Date().toISOString(),
    productCount: products.length,
    docsMatchedCount,
    sources: [`${SHOP}/products.json`, DOCS_PRODUCT_LIST],
  };

  writeFileSync(productsPath, JSON.stringify(products, null, 2) + "\n");
  writeFileSync(`${DATA_DIR}categories.json`, JSON.stringify(buildCategoryTree(products), null, 2) + "\n");
  writeFileSync(`${DATA_DIR}meta.json`, JSON.stringify(meta, null, 2) + "\n");

  const unmatched = docsEntries.filter((e) => !matchedDocs.has(e));
  console.error(`--- summary ---`);
  console.error(`products: ${products.length}`);
  console.error(`docs matched: ${docsMatchedCount} / ${products.length} products`);
  console.error(`docs entries unmatched: ${unmatched.length} / ${docsEntries.length}`);
  console.error(`EOL products: ${products.filter((p) => p.eol).length}`);
  const byCategory = new Map<string, number>();
  for (const p of products) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${cat}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
