// Fetches and normalizes the product snapshot from the official sources.
// Used by scripts/update-data.ts (repo snapshot), the update_catalog MCP
// tool, and the startup auto-refresh (both persist to the user cache dir).

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type {
  CategoryNode,
  CompatibilityRules,
  NormalizedProduct,
  SnapshotMeta,
} from "../data/types.js";
import { CATEGORY_COLLECTIONS, CATEGORY_LABELS } from "./categories.js";
import {
  buildDocsIndexes,
  matchDocs,
  normalizeProduct,
  type DocsEntry,
  type ShopifyProduct,
} from "./normalize.js";

export const SHOP = "https://shop.m5stack.com";
export const DOCS_PRODUCT_LIST =
  "https://raw.githubusercontent.com/m5stack/m5-docs/master/docs/en/product_list.json";
const USER_AGENT = "m5stack-mcp-updater/0.1 (+https://github.com/necobit/M5Stack-MCP)";

export interface Snapshot {
  products: NormalizedProduct[];
  categories: CategoryNode[];
  meta: SnapshotMeta;
}

export interface FetchOptions {
  intervalMs?: number;
  log?: (message: string) => void;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await sleep(1000 * 2 ** attempt);
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

async function fetchAllProducts(intervalMs: number, log: (m: string) => void): Promise<ShopifyProduct[]> {
  const all: ShopifyProduct[] = [];
  for (let page = 1; ; page++) {
    const data = (await fetchJson(`${SHOP}/products.json?limit=250&page=${page}`)) as {
      products: unknown[];
    };
    if (!data.products?.length) break;
    for (const p of data.products) {
      all.push(ShopifyProductSchema.parse(p));
    }
    log(`products page ${page}: ${data.products.length} items (total ${all.length})`);
    await sleep(intervalMs);
  }
  return all;
}

async function fetchCollectionMembership(
  intervalMs: number,
  log: (m: string) => void,
): Promise<Map<string, string[]>> {
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
        log(`collection ${collection}: fetch failed (${err}), skipping`);
        break;
      }
      if (!data.products?.length) break;
      for (const p of data.products) {
        const list = handleToCollections.get(p.handle) ?? [];
        list.push(collection);
        handleToCollections.set(p.handle, list);
        count++;
      }
      await sleep(intervalMs);
    }
    log(`collection ${collection}: ${count} products`);
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

export function buildCategoryTree(products: NormalizedProduct[]): CategoryNode[] {
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

export async function fetchSnapshot(
  rules: CompatibilityRules,
  options: FetchOptions = {},
): Promise<Snapshot> {
  const intervalMs = options.intervalMs ?? 500;
  const log = options.log ?? (() => {});

  log("fetching shop products...");
  const shopProducts = await fetchAllProducts(intervalMs, log);
  log("fetching collection membership...");
  const membership = await fetchCollectionMembership(intervalMs, log);
  log("fetching docs product list...");
  const docsEntries = await fetchDocsEntries();
  const { docsBySku, docsByTitle } = buildDocsIndexes(docsEntries);

  const products: NormalizedProduct[] = shopProducts
    .map((raw) => {
      const docsMatch = matchDocs(raw, docsBySku, docsByTitle);
      const curated =
        rules.portRequirements[raw.handle] ??
        (raw.variants[0]?.sku ? rules.portRequirements[raw.variants[0].sku] : undefined);
      return normalizeProduct(raw, membership.get(raw.handle) ?? [], docsMatch, curated);
    })
    .sort((a, b) => a.handle.localeCompare(b.handle));

  const meta: SnapshotMeta = {
    fetchedAt: new Date().toISOString(),
    productCount: products.length,
    docsMatchedCount: products.filter((p) => p.docs).length,
    sources: [`${SHOP}/products.json`, DOCS_PRODUCT_LIST],
  };

  return { products, categories: buildCategoryTree(products), meta };
}

// Safety valve shared by all update paths: a drastically smaller snapshot
// almost certainly means the shop endpoint changed, not the lineup.
export function assertNoCollapse(previousCount: number, nextCount: number): void {
  if (previousCount > 0 && nextCount < previousCount * 0.8) {
    throw new Error(
      `Aborting: new snapshot has ${nextCount} products, previous had ${previousCount} (>20% drop)`,
    );
  }
}

export interface SnapshotDiff {
  added: string[];
  removed: string[];
  newlyEol: string[];
  priceChanged: number;
}

export function diffSnapshots(previous: NormalizedProduct[], next: NormalizedProduct[]): SnapshotDiff {
  const prevByHandle = new Map(previous.map((p) => [p.handle, p]));
  const nextByHandle = new Map(next.map((p) => [p.handle, p]));
  return {
    added: next.filter((p) => !prevByHandle.has(p.handle)).map((p) => p.handle),
    removed: previous.filter((p) => !nextByHandle.has(p.handle)).map((p) => p.handle),
    newlyEol: next
      .filter((p) => {
        const prev = prevByHandle.get(p.handle);
        return prev && !prev.eol && p.eol;
      })
      .map((p) => p.handle),
    priceChanged: next.filter((p) => {
      const prev = prevByHandle.get(p.handle);
      return (
        prev &&
        (prev.priceRange.min !== p.priceRange.min || prev.priceRange.max !== p.priceRange.max)
      );
    }).length,
  };
}

// --- user-local cache (~/.cache/m5stack-mcp) ---
// Refreshed snapshots live outside the package so npx/global installs stay
// read-only and a package update never fights a newer local snapshot.

export function getCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "m5stack-mcp");
}

export function persistSnapshotToCache(snapshot: Snapshot): string {
  const dir = getCacheDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "products.json"), JSON.stringify(snapshot.products, null, 2) + "\n");
  writeFileSync(join(dir, "categories.json"), JSON.stringify(snapshot.categories, null, 2) + "\n");
  writeFileSync(join(dir, "meta.json"), JSON.stringify(snapshot.meta, null, 2) + "\n");
  return dir;
}
