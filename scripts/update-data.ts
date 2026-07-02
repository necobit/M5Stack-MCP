// Regenerates data/products.json, data/categories.json and data/meta.json
// (the snapshot bundled with the package). The fetch/normalize pipeline
// lives in src/lib/updater.ts, shared with the server's update_catalog tool
// and startup auto-refresh. Run with: npm run update-data

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { CompatibilityRules, NormalizedProduct } from "../src/data/types.js";
import { assertNoCollapse, diffSnapshots, fetchSnapshot } from "../src/lib/updater.js";

const DATA_DIR = fileURLToPath(new URL("../data/", import.meta.url));

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const rules = JSON.parse(
    readFileSync(`${DATA_DIR}compatibility-rules.json`, "utf8"),
  ) as CompatibilityRules;

  const snapshot = await fetchSnapshot(rules, { intervalMs: 500, log: console.error });

  const productsPath = `${DATA_DIR}products.json`;
  if (existsSync(productsPath)) {
    const previous = JSON.parse(readFileSync(productsPath, "utf8")) as NormalizedProduct[];
    assertNoCollapse(previous.length, snapshot.products.length);
    const diff = diffSnapshots(previous, snapshot.products);
    console.error(`--- diff vs previous snapshot ---`);
    console.error(`added: ${diff.added.length}${diff.added.length ? " — " + diff.added.join(", ") : ""}`);
    console.error(`removed: ${diff.removed.length}${diff.removed.length ? " — " + diff.removed.join(", ") : ""}`);
    console.error(`newly EOL: ${diff.newlyEol.length}${diff.newlyEol.length ? " — " + diff.newlyEol.join(", ") : ""}`);
    console.error(`price changed: ${diff.priceChanged}`);
  }

  writeFileSync(productsPath, JSON.stringify(snapshot.products, null, 2) + "\n");
  writeFileSync(`${DATA_DIR}categories.json`, JSON.stringify(snapshot.categories, null, 2) + "\n");
  writeFileSync(`${DATA_DIR}meta.json`, JSON.stringify(snapshot.meta, null, 2) + "\n");

  console.error(`--- summary ---`);
  console.error(`products: ${snapshot.products.length}`);
  console.error(`docs matched: ${snapshot.meta.docsMatchedCount} / ${snapshot.products.length} products`);
  console.error(`EOL products: ${snapshot.products.filter((p) => p.eol).length}`);
  const byCategory = new Map<string, number>();
  for (const p of snapshot.products) byCategory.set(p.category, (byCategory.get(p.category) ?? 0) + 1);
  for (const [cat, n] of [...byCategory.entries()].sort((a, b) => b[1] - a[1])) {
    console.error(`  ${cat}: ${n}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
