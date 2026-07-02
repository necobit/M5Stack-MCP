import { readFileSync } from "node:fs";
import type {
  CategoryNode,
  CompatibilityRules,
  NormalizedProduct,
  SnapshotMeta,
} from "./types.js";

// Resolved relative to the compiled file (dist/data/loader.js), so the
// bundled data/ directory is found both in a git checkout and inside an
// npm/npx installation.
const DATA_DIR = new URL("../../data/", import.meta.url);

function loadJson<T>(name: string): T {
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
}

let catalog: Catalog | null = null;

export function loadCatalog(): Catalog {
  if (catalog) return catalog;

  const products = loadJson<NormalizedProduct[]>("products.json");
  const categories = loadJson<CategoryNode[]>("categories.json");
  const meta = loadJson<SnapshotMeta>("meta.json");
  const rules = loadJson<CompatibilityRules>("compatibility-rules.json");

  const byHandle = new Map<string, NormalizedProduct>();
  const bySku = new Map<string, NormalizedProduct>();
  for (const p of products) {
    byHandle.set(p.handle, p);
    for (const v of p.variants) {
      if (v.sku) bySku.set(v.sku.toUpperCase(), p);
    }
  }

  // handle exact -> SKU exact -> SKU prefix -> title substring
  function resolve(identifier: string): NormalizedProduct | null {
    const id = identifier.trim();
    const exact = byHandle.get(id.toLowerCase()) ?? bySku.get(id.toUpperCase());
    if (exact) return exact;

    const upper = id.toUpperCase();
    for (const [sku, p] of bySku) {
      if (sku.startsWith(upper)) return p;
    }
    const lower = id.toLowerCase();
    const titleMatches = products.filter((p) => p.title.toLowerCase().includes(lower));
    return titleMatches.length === 1 ? titleMatches[0] : null;
  }

  function resolveCandidates(identifier: string): NormalizedProduct[] {
    const lower = identifier.trim().toLowerCase();
    return products.filter((p) => p.title.toLowerCase().includes(lower)).slice(0, 5);
  }

  catalog = { products, categories, meta, rules, byHandle, bySku, resolve, resolveCandidates };
  return catalog;
}
