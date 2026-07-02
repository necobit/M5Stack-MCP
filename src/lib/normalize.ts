import type {
  Category,
  Connectivity,
  DocsInfo,
  DocsMatchType,
  GrovePort,
  NormalizedProduct,
} from "../data/types.js";
import { deriveCategory, deriveFormFactor } from "./categories.js";

// Raw shapes as returned by the Shopify storefront JSON endpoints.
export interface ShopifyProduct {
  id: number;
  title: string;
  handle: string;
  body_html: string | null;
  tags: string[];
  variants: {
    sku: string | null;
    title: string;
    price: string;
    available: boolean;
  }[];
  images: { src: string }[];
}

// Raw entry from m5-docs product_list.json.
export interface DocsEntry {
  p: string;
  sku: string;
  category: string;
  a: string;
  qs?: string;
  img?: string;
  kw?: string[] | string;
}

const EOL_PREFIX = /^\s*\[EOL\]\s*/i;
const DESCRIPTION_MAX = 1500;

export function htmlToText(html: string | null): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim()
    // Shop pages start the body with a "Description" heading; drop the noise.
    .replace(/^Description\s*\n?/i, "");
}

export function extractConnectivity(text: string, keywords: string[]): Connectivity {
  const haystack = `${text}\n${keywords.join(" ")}`;
  const grove = new Set<GrovePort>();
  for (const m of haystack.matchAll(/port\s*[.\-]?\s*([ABC])\b/gi)) {
    grove.add(m[1].toUpperCase() as GrovePort);
  }
  // A bare Grove (HY2.0-4P) mention without an explicit port letter implies Port A (I2C).
  if (grove.size === 0 && /HY2\.0-4P|grove/i.test(haystack)) {
    grove.add("A");
  }

  const interfaces: string[] = [];
  const patterns: [string, RegExp][] = [
    ["I2C", /\bI2C\b|\bIIC\b/i],
    ["UART", /\bUART\b/i],
    ["SPI", /\bSPI\b/i],
    ["GPIO", /\bGPIO\b/i],
    ["CAN", /\bCAN\s*bus\b|\bCAN\b/],
    ["RS485", /RS-?485/i],
    ["RS232", /RS-?232/i],
    ["ADC", /\bADC\b/i],
    ["DAC", /\bDAC\b/i],
    ["PWM", /\bPWM\b/i],
  ];
  for (const [name, re] of patterns) {
    if (re.test(haystack)) interfaces.push(name);
  }

  const i2cMatch = haystack.match(/0x[0-9A-Fa-f]{2}\b/);

  const found = grove.size > 0 || interfaces.length > 0;
  return {
    grove: [...grove].sort() as GrovePort[],
    interfaces,
    i2cAddress: i2cMatch ? i2cMatch[0].toLowerCase() : null,
    source: found ? "extracted" : "unknown",
  };
}

function normalizeTitleForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(EOL_PREFIX, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface DocsMatchResult {
  entry: DocsEntry;
  matchType: DocsMatchType;
}

export function matchDocs(
  product: ShopifyProduct,
  docsBySku: Map<string, DocsEntry>,
  docsByTitle: Map<string, DocsEntry>,
): DocsMatchResult | null {
  const skus = product.variants.map((v) => v.sku).filter((s): s is string => !!s);

  for (const sku of skus) {
    const exact = docsBySku.get(sku.toUpperCase());
    if (exact) return { entry: exact, matchType: "exact-sku" };
  }
  for (const sku of skus) {
    const upper = sku.toUpperCase();
    for (const [docsSku, entry] of docsBySku) {
      if (docsSku.length >= 3 && (upper.startsWith(docsSku) || docsSku.startsWith(upper))) {
        return { entry, matchType: "prefix-sku" };
      }
    }
  }
  const byTitle = docsByTitle.get(normalizeTitleForMatch(product.title));
  if (byTitle) return { entry: byTitle, matchType: "title" };

  return null;
}

export function buildDocsIndexes(entries: DocsEntry[]): {
  docsBySku: Map<string, DocsEntry>;
  docsByTitle: Map<string, DocsEntry>;
} {
  const docsBySku = new Map<string, DocsEntry>();
  const docsByTitle = new Map<string, DocsEntry>();
  for (const e of entries) {
    if (e.sku) docsBySku.set(e.sku.toUpperCase(), e);
    docsByTitle.set(normalizeTitleForMatch(e.p), e);
  }
  return { docsBySku, docsByTitle };
}

function docsKeywords(entry: DocsEntry): string[] {
  if (Array.isArray(entry.kw)) return entry.kw;
  if (typeof entry.kw === "string") return entry.kw.split(/[\s,;]+/).filter(Boolean);
  return [];
}

export function normalizeProduct(
  raw: ShopifyProduct,
  collections: string[],
  docsMatch: DocsMatchResult | null,
  curatedPorts: { grove: GrovePort[] } | undefined,
): NormalizedProduct {
  const eol = EOL_PREFIX.test(raw.title);
  const title = raw.title.replace(EOL_PREFIX, "").trim();
  const docsCategory = docsMatch?.entry.category ?? null;

  const category: Category = deriveCategory({
    collections,
    tags: raw.tags,
    title,
    docsCategory,
  });

  const descriptionText = htmlToText(raw.body_html).slice(0, DESCRIPTION_MAX);
  const keywords = docsMatch ? docsKeywords(docsMatch.entry) : [];

  let connectivity = extractConnectivity(descriptionText, keywords);
  if (curatedPorts) {
    connectivity = { ...connectivity, grove: curatedPorts.grove, source: "curated" };
  }

  const prices = raw.variants.map((v) => Number.parseFloat(v.price)).filter((n) => !Number.isNaN(n));

  const docs: DocsInfo | null = docsMatch
    ? {
        category: docsMatch.entry.category,
        docUrl: docsMatch.entry.a,
        quickstartUrl: docsMatch.entry.qs || null,
        keywords,
        matchType: docsMatch.matchType,
      }
    : null;

  return {
    handle: raw.handle,
    shopifyId: raw.id,
    title,
    eol,
    sku: raw.variants.find((v) => v.sku)?.sku ?? null,
    category,
    formFactor: deriveFormFactor(category, title, raw.tags),
    subcategories: [...collections].sort(),
    tags: raw.tags,
    descriptionText,
    variants: raw.variants.map((v) => ({
      sku: v.sku || null,
      title: v.title,
      price: v.price,
      available: v.available,
    })),
    priceRange: {
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      currency: "USD",
    },
    imageUrl: raw.images[0]?.src ?? null,
    url: `https://shop.m5stack.com/products/${raw.handle}`,
    docs,
    connectivity,
  };
}
