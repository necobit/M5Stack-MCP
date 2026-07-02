import type { Category, NormalizedProduct } from "../data/types.js";

export interface SearchOptions {
  query?: string;
  category?: Category;
  tags?: string[];
  maxPriceUsd?: number;
  includeEol?: boolean;
  inStockOnly?: boolean;
  limit?: number;
}

export interface ScoredProduct {
  product: NormalizedProduct;
  score: number;
}

// Field weights: docs keywords are the highest-signal source (hand-written by
// M5Stack), then tags, title, description.
const WEIGHT_KEYWORD = 10;
const WEIGHT_TAG = 6;
const WEIGHT_TITLE = 8;
const WEIGHT_DESCRIPTION = 2;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9.]+/)
    .filter((t) => t.length >= 2);
}

export function scoreProduct(product: NormalizedProduct, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 1;

  const title = product.title.toLowerCase();
  const description = product.descriptionText.toLowerCase();
  const tags = product.tags.map((t) => t.toLowerCase());
  const keywords = (product.docs?.keywords ?? []).map((k) => k.toLowerCase());

  let score = 0;
  let matchedTokens = 0;
  for (const token of queryTokens) {
    let tokenScore = 0;
    if (keywords.some((k) => k.includes(token))) tokenScore += WEIGHT_KEYWORD;
    if (tags.some((t) => t.includes(token))) tokenScore += WEIGHT_TAG;
    if (title.includes(token)) tokenScore += WEIGHT_TITLE;
    if (description.includes(token)) tokenScore += WEIGHT_DESCRIPTION;
    if (tokenScore > 0) matchedTokens++;
    score += tokenScore;
  }
  if (matchedTokens === 0) return 0;
  // Prefer products matching more of the query terms over one strong term.
  return score * (matchedTokens / queryTokens.length);
}

export function searchProducts(
  products: NormalizedProduct[],
  options: SearchOptions,
): { total: number; results: ScoredProduct[] } {
  const queryTokens = options.query ? tokenize(options.query) : [];
  const wantedTags = (options.tags ?? []).map((t) => t.toLowerCase());

  const scored: ScoredProduct[] = [];
  for (const product of products) {
    if (!options.includeEol && product.eol) continue;
    if (options.category && product.category !== options.category) continue;
    if (options.maxPriceUsd !== undefined && product.priceRange.min > options.maxPriceUsd) continue;
    if (options.inStockOnly && !product.variants.some((v) => v.available)) continue;
    if (
      wantedTags.length > 0 &&
      !wantedTags.every((w) => product.tags.some((t) => t.toLowerCase().includes(w)))
    ) {
      continue;
    }
    const score = scoreProduct(product, queryTokens);
    if (score <= 0) continue;
    scored.push({ product, score });
  }

  scored.sort((a, b) => b.score - a.score || a.product.handle.localeCompare(b.product.handle));
  return { total: scored.length, results: scored.slice(0, options.limit ?? 20) };
}

export function toSummary(product: NormalizedProduct) {
  return {
    handle: product.handle,
    title: product.title,
    sku: product.sku,
    category: product.category,
    formFactor: product.formFactor,
    eol: product.eol,
    priceUsd: product.priceRange.min,
    available: product.variants.some((v) => v.available),
    summary: product.descriptionText.slice(0, 200),
    url: product.url,
  };
}
