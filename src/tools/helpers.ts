import type { Catalog } from "../data/loader.js";
import type { NormalizedProduct } from "../data/types.js";

export function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

// Every tool response carries the snapshot timestamp so the assistant knows
// how fresh the data is.
export function withDataAsOf<T extends object>(catalog: Catalog, payload: T) {
  return { ...payload, data_as_of: catalog.meta.fetchedAt };
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
