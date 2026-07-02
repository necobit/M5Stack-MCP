import type { Catalog } from "../data/loader.js";
import type { NormalizedProduct } from "../data/types.js";

export function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

// Every tool response carries the snapshot timestamp so the assistant knows
// how fresh the data is. M5Stack releases new products weekly, so past a
// threshold we nudge the assistant to suggest refreshing the snapshot.
const STALE_AFTER_DAYS = 45;

export function withDataAsOf<T extends object>(catalog: Catalog, payload: T) {
  const ageDays = Math.floor((Date.now() - Date.parse(catalog.meta.fetchedAt)) / 86_400_000);
  return {
    ...payload,
    data_as_of: catalog.meta.fetchedAt,
    ...(ageDays >= STALE_AFTER_DAYS
      ? {
          data_freshness_warning:
            `Product snapshot is ${ageDays} days old; M5Stack ships new products weekly. ` +
            "Newer products may be missing — suggest the user update (git pull or `npm run update-data`).",
        }
      : {}),
  };
}

export function resolveOrError(
  catalog: Catalog,
  identifier: string,
): { product: NormalizedProduct } | { error: string; candidates: string[] } {
  const product = catalog.resolve(identifier);
  if (product) return { product };
  return {
    error: `No product found for identifier "${identifier}"`,
    candidates: catalog.resolveCandidates(identifier).map((p) => `${p.handle} (${p.title})`),
  };
}
