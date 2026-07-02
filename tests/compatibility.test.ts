import { describe, expect, it } from "vitest";
import { checkPair } from "../src/lib/compatibility.js";
import type { CompatibilityRules, NormalizedProduct } from "../src/data/types.js";

function product(overrides: Partial<NormalizedProduct>): NormalizedProduct {
  return {
    handle: "x",
    shopifyId: 1,
    title: "X",
    eol: false,
    sku: null,
    category: "unit",
    formFactor: "UNIT",
    subcategories: [],
    tags: [],
    descriptionText: "",
    variants: [{ sku: null, title: "Default", price: "1.00", available: true }],
    priceRange: { min: 1, max: 1, currency: "USD" },
    imageUrl: null,
    url: "https://shop.m5stack.com/products/x",
    docs: null,
    connectivity: { grove: [], interfaces: [], i2cAddress: null, source: "unknown" },
    ...overrides,
  };
}

const rules: CompatibilityRules = {
  controllers: {
    cores3: { family: "CORE", generation: "CoreS3", grovePorts: ["A", "B", "C"], mbus: "M-Bus-Core2" },
    basic: { family: "CORE", generation: "Core1", grovePorts: ["A"], mbus: "M-Bus-Core1" },
    atoms3: { family: "ATOM", generation: "ATOM-S3", grovePorts: ["A"] },
    stickc: { family: "STICKC", generation: "PLUS2", grovePorts: ["A"] },
    "stamp-bare": { family: "STAMP", grovePorts: [] },
  },
  overrides: [
    {
      peripheral: "special-module",
      hosts: ["CORE"],
      excludeGenerations: ["Core1"],
      verdict: "compatible",
      note: "Core2/CoreS3 only",
    },
  ],
  portRequirements: {},
};

const cores3 = product({ handle: "cores3", category: "controller", formFactor: "CORE_HOST" });
const basic = product({ handle: "basic", category: "controller", formFactor: "CORE_HOST" });
const atoms3 = product({ handle: "atoms3", category: "controller", formFactor: "ATOM_HOST" });
const stickc = product({ handle: "stickc", category: "controller", formFactor: "STICKC_HOST" });

describe("unit compatibility", () => {
  it("grove unit works on any curated controller with a port", () => {
    const unit = product({ connectivity: { grove: ["A"], interfaces: ["I2C"], i2cAddress: "0x44", source: "extracted" } });
    expect(checkPair(cores3, unit, rules).verdict).toBe("compatible");
    expect(checkPair(atoms3, unit, rules).verdict).toBe("compatible");
    expect(checkPair(stickc, unit, rules).verdict).toBe("compatible");
  });

  it("port B unit on port-A-only controller is conditional", () => {
    const unitB = product({ connectivity: { grove: ["B"], interfaces: [], i2cAddress: null, source: "extracted" } });
    const res = checkPair(atoms3, unitB, rules);
    expect(res.verdict).toBe("conditional");
    expect(res.notes.join(" ")).toMatch(/Port B/);
  });

  it("bare stamp without grove socket is incompatible", () => {
    const unit = product({ connectivity: { grove: ["A"], interfaces: [], i2cAddress: null, source: "extracted" } });
    const stampBare = product({ handle: "stamp-bare", category: "controller", formFactor: "STAMP_HOST" });
    expect(checkPair(stampBare, unit, rules).verdict).toBe("incompatible");
  });
});

describe("module compatibility", () => {
  const module132 = product({ title: "Relay 13.2 Module", category: "module", formFactor: "MODULE" });

  it("module works on Core family", () => {
    expect(checkPair(cores3, module132, rules).verdict).toBe("compatible");
  });

  it("13.2 module on Core1 is conditional", () => {
    expect(checkPair(basic, module132, rules).verdict).toBe("conditional");
  });

  it("module on ATOM is incompatible", () => {
    expect(checkPair(atoms3, module132, rules).verdict).toBe("incompatible");
  });
});

describe("hat and atomic base", () => {
  const hat = product({ category: "hat", formFactor: "HAT" });
  const atomicBase = product({ category: "atomic-base", formFactor: "ATOMIC_BASE" });

  it("hat fits StickC only", () => {
    expect(checkPair(stickc, hat, rules).verdict).toBe("compatible");
    expect(checkPair(cores3, hat, rules).verdict).toBe("incompatible");
  });

  it("atomic base fits ATOM only", () => {
    expect(checkPair(atoms3, atomicBase, rules).verdict).toBe("compatible");
    expect(checkPair(stickc, atomicBase, rules).verdict).toBe("incompatible");
  });
});

describe("overrides and metadata", () => {
  it("generation-excluding override wins", () => {
    const special = product({ handle: "special-module", category: "module", formFactor: "MODULE" });
    expect(checkPair(basic, special, rules).verdict).toBe("incompatible");
    expect(checkPair(cores3, special, rules).verdict).toBe("compatible");
  });

  it("EOL products get a warning note", () => {
    const eolUnit = product({ eol: true, title: "Old Unit", connectivity: { grove: ["A"], interfaces: [], i2cAddress: null, source: "extracted" } });
    const res = checkPair(cores3, eolUnit, rules);
    expect(res.notes.join(" ")).toMatch(/EOL/);
  });

  it("uncurated controller yields lower confidence, never 'high' unknowns", () => {
    const unknownCtrl = product({ handle: "mystery", category: "controller", formFactor: "CORE_HOST" });
    const unit = product({ connectivity: { grove: ["A"], interfaces: [], i2cAddress: null, source: "extracted" } });
    const res = checkPair(unknownCtrl, unit, rules);
    expect(res.confidence).not.toBe("high");
  });
});
