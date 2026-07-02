import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  CategoryNode,
  CompatibilityRules,
  NormalizedProduct,
  SnapshotMeta,
} from "./types.js";
import { getCacheDir, type Snapshot } from "../lib/updater.js";

// Resolved relative to the compiled file (dist/data/loader.js), so the
// bundled data/ directory is found both in a git checkout and inside an
// npm/npx installation.
const DATA_DIR = new URL("../../data/", import.meta.url);

function loadBundled<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(name, DATA_DIR), "utf8")) as T;
}

export interface Catalog {
  products: NormalizedProduct[];
  categories: CategoryNode[];
  meta: SnapshotMeta;
  rules: CompatibilityRules;
  byHandle: Map<string, NormalizedProduct>;
  bySku: Map<string, NormalizedProduct>;
  resolve(identifier: string): NormalizedProduct | null;
  resolveCandidates(identifier: string): NormalizedProduct[];
  /** Replace the product snapshot in place (hot swap after a refresh). */
  swap(snapshot: Snapshot): void;
  ageDays(): number;
}

let catalog: Catalog | null = null;

// A refreshed snapshot in the user cache dir wins over the bundled one when
// it is newer (the bundled one can leapfrog it via a package update).
function loadFreshest(): Snapshot {
  const bundled: Snapshot = {
    products: loadBundled<NormalizedProduct[]>("products.json"),
    categories: loadBundled<CategoryNode[]>("categories.json"),
    meta: loadBundled<SnapshotMeta>("meta.json"),
  };
  try {
    const dir = getCacheDir();
    const metaPath = join(dir, "meta.json");
    if (!existsSync(metaPath)) return bundled;
    const cachedMeta = JSON.parse(readFileSync(metaPath, "utf8")) as SnapshotMeta;
    if (Date.parse(cachedMeta.fetchedAt) <= Date.parse(bundled.meta.fetchedAt)) return bundled;
    const cached: Snapshot = {
      products: JSON.parse(readFileSync(join(dir, "products.json"), "utf8")),
      categories: JSON.parse(readFileSync(join(dir, "categories.json"), "utf8")),
      meta: cachedMeta,
    };
    if (!Array.isArray(cached.products) || cached.products.length === 0) return bundled;
    console.error(`m5stack-mcp: using cached snapshot from ${dir} (${cachedMeta.fetchedAt})`);
    return cached;
  } catch (err) {
    console.error(`m5stack-mcp: ignoring unreadable cache (${err})`);
    return bundled;
  }
}

export function loadCatalog(): Catalog {
  if (catalog) return catalog;

  const rules = loadBundled<CompatibilityRules>("compatibility-rules.json");
  const initial = loadFreshest();

  const state: Catalog = {
    products: [],
    categories: [],
    meta: { fetchedAt: "", productCount: 0, docsMatchedCount: 0, sources: [] },
    rules,
    byHandle: new Map(),
    bySku: new Map(),

    // handle exact -> SKU exact -> SKU prefix -> title substring
    resolve(identifier: string): NormalizedProduct | null {
      const id = identifier.trim();
      const exact = state.byHandle.get(id.toLowerCase()) ?? state.bySku.get(id.toUpperCase());
      if (exact) return exact;

      const upper = id.toUpperCase();
      for (const [sku, p] of state.bySku) {
        if (sku.startsWith(upper)) return p;
      }
      const lower = id.toLowerCase();
      const titleMatches = state.products.filter((p) => p.title.toLowerCase().includes(lower));
      return titleMatches.length === 1 ? titleMatches[0] : null;
    },

    resolveCandidates(identifier: string): NormalizedProduct[] {
      const lower = identifier.trim().toLowerCase();
      return state.products.filter((p) => p.title.toLowerCase().includes(lower)).slice(0, 5);
    },

    swap(snapshot: Snapshot): void {
      state.products = snapshot.products;
      state.categories = snapshot.categories;
      state.meta = snapshot.meta;
      state.byHandle = new Map(snapshot.products.map((p) => [p.handle, p]));
      state.bySku = new Map();
      for (const p of snapshot.products) {
        for (const v of p.variants) {
          if (v.sku) state.bySku.set(v.sku.toUpperCase(), p);
        }
      }
    },

    ageDays(): number {
      return Math.floor((Date.now() - Date.parse(state.meta.fetchedAt)) / 86_400_000);
    },
  };

  state.swap(initial);
  catalog = state;
  return catalog;
}
