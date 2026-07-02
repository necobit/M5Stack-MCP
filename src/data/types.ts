// Shared contract between scripts/update-data.ts (producer) and the MCP server (consumer).

export type Category =
  | "controller"
  | "unit"
  | "module"
  | "hat"
  | "atomic-base"
  | "stamp-accessory"
  | "kit"
  | "accessory";

export type FormFactor =
  | "CORE_HOST"
  | "ATOM_HOST"
  | "STICKC_HOST"
  | "STAMP_HOST"
  | "UNIT"
  | "MODULE"
  | "BASE"
  | "HAT"
  | "ATOMIC_BASE"
  | "ACCESSORY"
  | "STANDALONE";

export type ControllerFamily = "CORE" | "ATOM" | "STICKC" | "STAMP" | "OTHER";

export type GrovePort = "A" | "B" | "C";

export type DocsMatchType = "exact-sku" | "prefix-sku" | "title";

export interface ProductVariant {
  sku: string | null;
  title: string;
  price: string;
  available: boolean;
}

export interface DocsInfo {
  category: string;
  docUrl: string;
  quickstartUrl: string | null;
  keywords: string[];
  matchType: DocsMatchType;
}

export interface Connectivity {
  grove: GrovePort[];
  interfaces: string[];
  i2cAddress: string | null;
  source: "curated" | "extracted" | "unknown";
}

export interface NormalizedProduct {
  handle: string;
  shopifyId: number;
  title: string;
  eol: boolean;
  sku: string | null;
  category: Category;
  formFactor: FormFactor;
  subcategories: string[];
  tags: string[];
  descriptionText: string;
  variants: ProductVariant[];
  priceRange: { min: number; max: number; currency: "USD" };
  imageUrl: string | null;
  url: string;
  docs: DocsInfo | null;
  connectivity: Connectivity;
}

export interface CategoryNode {
  category: Category;
  label: string;
  total: number;
  eolCount: number;
  subcategories: { handle: string; count: number }[];
}

export interface SnapshotMeta {
  fetchedAt: string;
  productCount: number;
  docsMatchedCount: number;
  sources: string[];
}

// --- compatibility-rules.json ---

export interface ControllerRule {
  family: ControllerFamily;
  generation?: string;
  grovePorts: GrovePort[];
  mbus?: string;
  notes?: string;
}

export interface CompatOverride {
  peripheral: string;
  hosts: ControllerFamily[];
  excludeGenerations?: string[];
  includeGenerations?: string[];
  verdict: "compatible" | "conditional" | "incompatible";
  note: string;
}

export interface CompatibilityRules {
  controllers: Record<string, ControllerRule>;
  overrides: CompatOverride[];
  portRequirements: Record<string, { grove: GrovePort[] }>;
}
