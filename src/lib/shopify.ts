// Live price/stock lookups against shop.m5stack.com. Everything else is
// served from the bundled snapshot; only these single-product fetches hit
// the network at tool-call time.

const SHOP = "https://shop.m5stack.com";
const USER_AGENT = "m5stack-mcp/0.1 (+https://github.com/necobit/M5Stack-MCP)";
const TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface LiveVariant {
  sku: string | null;
  title: string;
  price: string;
  available: boolean;
}

export interface LiveProduct {
  handle: string;
  variants: LiveVariant[];
  fetchedAt: string;
}

const cache = new Map<string, { value: LiveProduct; expires: number }>();

export async function fetchLiveProduct(handle: string): Promise<LiveProduct | null> {
  const cached = cache.get(handle);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const res = await fetch(`${SHOP}/products/${handle}.json`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      product?: {
        handle: string;
        variants?: { sku?: string | null; title: string; price: string; available?: boolean }[];
      };
    };
    if (!data.product) return null;
    const live: LiveProduct = {
      handle: data.product.handle,
      variants: (data.product.variants ?? []).map((v) => ({
        sku: v.sku || null,
        title: v.title,
        price: v.price,
        // /products/{handle}.json omits `available` on some shops; treat missing as unknown-true.
        available: v.available ?? true,
      })),
      fetchedAt: new Date().toISOString(),
    };
    cache.set(handle, { value: live, expires: Date.now() + CACHE_TTL_MS });
    return live;
  } catch {
    return null;
  }
}
