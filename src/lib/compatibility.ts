import type {
  CompatibilityRules,
  ControllerFamily,
  ControllerRule,
  GrovePort,
  NormalizedProduct,
} from "../data/types.js";

export type Verdict = "compatible" | "conditional" | "incompatible" | "unknown";
export type Basis = "curated-rule" | "form-factor-rule" | "extracted-heuristic" | "unknown";

export interface CompatResult {
  peripheral: string;
  peripheralTitle: string;
  verdict: Verdict;
  confidence: "high" | "medium" | "low";
  basis: Basis;
  requirements: string[];
  notes: string[];
  docUrl: string | null;
}

interface HostInfo {
  family: ControllerFamily;
  generation: string | null;
  grovePorts: GrovePort[];
  portsKnown: boolean;
  curated: boolean;
  notes: string[];
}

function familyFromFormFactor(product: NormalizedProduct): ControllerFamily {
  switch (product.formFactor) {
    case "CORE_HOST":
      return "CORE";
    case "ATOM_HOST":
      return "ATOM";
    case "STICKC_HOST":
      return "STICKC";
    case "STAMP_HOST":
      return "STAMP";
    default:
      return "OTHER";
  }
}

export function resolveHost(controller: NormalizedProduct, rules: CompatibilityRules): HostInfo {
  const rule: ControllerRule | undefined = rules.controllers[controller.handle];
  if (rule) {
    return {
      family: rule.family,
      generation: rule.generation ?? null,
      grovePorts: rule.grovePorts,
      portsKnown: true,
      curated: true,
      notes: rule.notes ? [rule.notes] : [],
    };
  }
  const extracted = controller.connectivity.source !== "unknown";
  return {
    family: familyFromFormFactor(controller),
    generation: null,
    grovePorts: controller.connectivity.grove,
    portsKnown: extracted && controller.connectivity.grove.length > 0,
    curated: false,
    notes: [],
  };
}

function checkGrovePorts(host: HostInfo, peripheral: NormalizedProduct): Partial<CompatResult> {
  const needed = peripheral.connectivity.grove;
  const requirements = ["Grove (HY2.0-4P) cable — usually bundled with the unit"];

  if (host.grovePorts.length === 0) {
    return host.portsKnown || host.curated
      ? {
          verdict: "incompatible",
          notes: ["Controller has no Grove socket (bare module or accessory)"],
        }
      : {
          verdict: "conditional",
          confidence: "low",
          notes: ["Controller Grove ports unknown; verify it has a Grove socket"],
          requirements,
        };
  }
  if (needed.length === 0 || peripheral.connectivity.source === "unknown") {
    return {
      verdict: "compatible",
      confidence: "medium",
      notes: ["Unit port requirement not extracted; most units use Port A (I2C)"],
      requirements,
    };
  }
  const missing = needed.filter((p) => !host.grovePorts.includes(p));
  if (missing.length === 0) {
    return { verdict: "compatible", requirements };
  }
  // Port B/C protocols (GPIO/UART) can usually be remapped to other pins on
  // ESP32, so a missing colored port is a caveat rather than a hard no.
  return {
    verdict: "conditional",
    requirements,
    notes: [
      `Unit expects Port ${missing.join("/")} which this controller does not expose; ` +
        "ESP32 pin remapping or a port-providing base may be needed",
    ],
  };
}

export function checkPair(
  controller: NormalizedProduct,
  peripheral: NormalizedProduct,
  rules: CompatibilityRules,
): CompatResult {
  const host = resolveHost(controller, rules);
  const base: CompatResult = {
    peripheral: peripheral.handle,
    peripheralTitle: peripheral.title,
    verdict: "unknown",
    confidence: host.curated ? "high" : "medium",
    basis: host.curated ? "curated-rule" : "form-factor-rule",
    requirements: [],
    notes: [...host.notes],
    docUrl: peripheral.docs?.docUrl ?? null,
  };

  const eolWarnings: string[] = [];
  if (controller.eol) eolWarnings.push(`Controller "${controller.title}" is EOL (discontinued)`);
  if (peripheral.eol) eolWarnings.push(`"${peripheral.title}" is EOL (discontinued)`);

  // Hand-curated per-product exceptions win over everything else.
  const peripheralSkus = peripheral.variants.map((v) => v.sku?.toUpperCase()).filter(Boolean);
  const override = rules.overrides.find(
    (o) => o.peripheral === peripheral.handle || peripheralSkus.includes(o.peripheral.toUpperCase()),
  );
  if (override) {
    const hostAllowed = override.hosts.includes(host.family);
    const generationExcluded =
      hostAllowed && host.generation !== null && (override.excludeGenerations?.includes(host.generation) ?? false);
    const generationRequired =
      hostAllowed &&
      override.includeGenerations !== undefined &&
      (host.generation === null || !override.includeGenerations.includes(host.generation));
    return {
      ...base,
      verdict: !hostAllowed || generationExcluded ? "incompatible" : generationRequired ? "conditional" : override.verdict,
      confidence: "high",
      basis: "curated-rule",
      notes: [...base.notes, override.note, ...eolWarnings],
    };
  }

  let result: CompatResult;
  switch (peripheral.formFactor) {
    case "UNIT": {
      const grove = checkGrovePorts(host, peripheral);
      const extractedPorts = peripheral.connectivity.source === "extracted";
      result = {
        ...base,
        verdict: grove.verdict ?? "compatible",
        confidence: grove.confidence ?? (host.curated && !extractedPorts ? "high" : "medium"),
        basis: extractedPorts && !host.curated ? "extracted-heuristic" : base.basis,
        requirements: grove.requirements ?? [],
        notes: [...base.notes, ...(grove.notes ?? [])],
      };
      break;
    }
    case "MODULE":
    case "BASE": {
      if (host.family !== "CORE") {
        result = {
          ...base,
          verdict: "incompatible",
          notes: [...base.notes, "M-Bus stackable modules fit the Core family only"],
        };
      } else {
        const is132 = /13\.2/.test(peripheral.title);
        const conditional = is132 && host.generation === "Core1";
        result = {
          ...base,
          verdict: conditional ? "conditional" : "compatible",
          notes: [
            ...base.notes,
            conditional
              ? "13.2 modules are sized for Core2/CoreS3; check the module's pin map before using with Core1"
              : "Stacks via M-Bus; verify GPIO pin conflicts when stacking multiple modules",
          ],
        };
      }
      break;
    }
    case "HAT": {
      const hatOk = host.family === "STICKC" || host.generation === "CoreInk";
      result = {
        ...base,
        verdict: hatOk ? "compatible" : "incompatible",
        notes: [
          ...base.notes,
          hatOk
            ? "Plugs into the 8-pin HAT header"
            : "HATs fit the StickC family (and CoreInk) 8-pin header only",
        ],
      };
      break;
    }
    case "ATOMIC_BASE": {
      result = {
        ...base,
        verdict: host.family === "ATOM" ? "compatible" : "incompatible",
        notes: [
          ...base.notes,
          host.family === "ATOM"
            ? "ATOM plugs directly into the Atomic base"
            : "Atomic bases fit the ATOM family only",
        ],
      };
      break;
    }
    default: {
      result = {
        ...base,
        verdict: "unknown",
        confidence: "low",
        basis: "unknown",
        notes: [
          ...base.notes,
          `No form-factor rule for category "${peripheral.category}"; check the product documentation`,
        ],
      };
    }
  }

  result.notes.push(...eolWarnings);
  return result;
}
