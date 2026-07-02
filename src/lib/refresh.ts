// Refreshes the in-memory catalog from the official sources and persists
// the result to the user cache dir. Shared by the update_catalog tool and
// the startup auto-refresh.

import type { Catalog } from "../data/loader.js";
import {
  assertNoCollapse,
  diffSnapshots,
  fetchSnapshot,
  persistSnapshotToCache,
  type SnapshotDiff,
} from "./updater.js";

export interface RefreshResult {
  refreshed: boolean;
  productCount: number;
  fetchedAt: string;
  diff: SnapshotDiff | null;
  cacheDir: string | null;
  message: string;
}

let inFlight: Promise<RefreshResult> | null = null;

export function refreshCatalog(catalog: Catalog): Promise<RefreshResult> {
  // Coalesce concurrent refreshes (startup auto-refresh vs tool call).
  if (inFlight) return inFlight;
  inFlight = doRefresh(catalog).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doRefresh(catalog: Catalog): Promise<RefreshResult> {
  const snapshot = await fetchSnapshot(catalog.rules, {
    intervalMs: 250,
    log: (m) => console.error(`m5stack-mcp refresh: ${m}`),
  });
  assertNoCollapse(catalog.products.length, snapshot.products.length);

  const diff = diffSnapshots(catalog.products, snapshot.products);
  let cacheDir: string | null = null;
  try {
    cacheDir = persistSnapshotToCache(snapshot);
  } catch (err) {
    // In-memory swap still helps this session even if the cache is unwritable.
    console.error(`m5stack-mcp refresh: could not persist cache (${err})`);
  }
  catalog.swap(snapshot);

  return {
    refreshed: true,
    productCount: snapshot.products.length,
    fetchedAt: snapshot.meta.fetchedAt,
    diff,
    cacheDir,
    message:
      `Catalog refreshed: ${snapshot.products.length} products ` +
      `(+${diff.added.length} new, -${diff.removed.length} removed, ${diff.newlyEol.length} newly EOL)`,
  };
}
