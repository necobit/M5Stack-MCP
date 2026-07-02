import type { Category, ControllerFamily, FormFactor } from "../data/types.js";

// Shopify collection handles used for category derivation. product_type is
// always empty on shop.m5stack.com, so collection membership is the primary
// signal, then tags, then the docs-side category.
export const CATEGORY_COLLECTIONS = [
  "controllers",
  "unit",
  "for-stack",
  "for-stick",
  "for-atom",
  "for-stamp",
  "for-chain",
  "accessories",
  "ai-hardware",
  "m5stack-new-arrival",
] as const;

export const CATEGORY_LABELS: Record<Category, string> = {
  controller: "Controllers (Core / Stick / Atom / Stamp ...)",
  unit: "Units (Grove-connected sensors & actuators)",
  module: "Modules (M-Bus stackable, for Core family)",
  hat: "Hats (for StickC family)",
  "atomic-base": "Atomic Bases (for ATOM family)",
  "stamp-accessory": "Stamp accessories",
  kit: "Kits",
  accessory: "Accessories (cables, mounts, power ...)",
};

export function deriveCategory(input: {
  collections: string[];
  tags: string[];
  title: string;
  docsCategory: string | null;
}): Category {
  const { collections, tags, title, docsCategory } = input;
  const t = title.toLowerCase();
  const lowerTags = tags.map((x) => x.toLowerCase());

  if (collections.includes("controllers")) return "controller";
  if (collections.includes("unit")) return "unit";
  if (collections.includes("for-stick")) return "hat";
  if (collections.includes("for-atom")) return "atomic-base";
  if (collections.includes("for-stamp")) return "stamp-accessory";
  if (collections.includes("for-stack")) {
    return /\bmodule\b|\bbase\b|\bboard\b/.test(t) ? "module" : "accessory";
  }

  if (lowerTags.some((x) => x.startsWith("unit")) || /\bunit\b/.test(t)) return "unit";
  if (lowerTags.includes("core") || lowerTags.includes("stamp") || lowerTags.includes("stick")) {
    return "controller";
  }
  if (/\bkit\b/.test(t) || docsCategory === "Kits") return "kit";
  if (docsCategory === "Controllers") return "controller";
  if (docsCategory === "Modules") return /\bhat\b/.test(t) ? "hat" : "module";

  if (/\bhat\b/.test(t)) return "hat";
  if (/\bmodule\b/.test(t)) return "module";
  if (/atomic .*base|atomic-base/.test(t)) return "atomic-base";

  return "accessory";
}

export function deriveControllerFamily(title: string, tags: string[]): ControllerFamily {
  const t = title.toLowerCase();
  const lowerTags = tags.map((x) => x.toLowerCase());
  if (/\batom\b|atoms3|atom lite|atom matrix|atom echo|nanoc6/.test(t)) return "ATOM";
  if (/stick/.test(t)) return "STICKC";
  if (/stamp/.test(t)) return "STAMP";
  if (/\bcore\b|cores3|core2|m5go|tough|fire\b|basic|gray|paper/.test(t)) return "CORE";
  if (lowerTags.includes("atom")) return "ATOM";
  if (lowerTags.includes("stick")) return "STICKC";
  if (lowerTags.includes("stamp")) return "STAMP";
  if (lowerTags.includes("core")) return "CORE";
  return "OTHER";
}

export function deriveFormFactor(category: Category, title: string, tags: string[]): FormFactor {
  switch (category) {
    case "controller": {
      const family = deriveControllerFamily(title, tags);
      if (family === "CORE") return "CORE_HOST";
      if (family === "ATOM") return "ATOM_HOST";
      if (family === "STICKC") return "STICKC_HOST";
      if (family === "STAMP") return "STAMP_HOST";
      return "STANDALONE";
    }
    case "unit":
      return "UNIT";
    case "module":
      return /\bbase\b/i.test(title) ? "BASE" : "MODULE";
    case "hat":
      return "HAT";
    case "atomic-base":
      return "ATOMIC_BASE";
    case "kit":
      return "STANDALONE";
    default:
      return "ACCESSORY";
  }
}
