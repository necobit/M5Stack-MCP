import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import type { NormalizedProduct } from "../data/types.js";
import { checkPair } from "../lib/compatibility.js";
import { searchProducts, toSummary } from "../lib/search.js";
import { suggestConfigurationInput } from "../schemas.js";
import { jsonResult, withDataAsOf } from "./helpers.js";

// Sensible general-purpose controllers to offer when the use case doesn't
// point at a specific one. Order = suggestion order.
const DEFAULT_CONTROLLERS = [
  "m5stack-cores3-esp32s3-iotdevelopment-kit",
  "atoms3-lite-esp32s3-dev-kit",
  "m5stickc-plus2-with-watch-accessories",
  "m5stack-nanoc6-dev-kit",
];

const FAMILY_TO_FORM: Record<string, string> = {
  CORE: "CORE_HOST",
  ATOM: "ATOM_HOST",
  STICKC: "STICKC_HOST",
  STAMP: "STAMP_HOST",
};

export function registerSuggestConfiguration(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "suggest_configuration",
    {
      title: "Suggest an M5Stack configuration",
      description:
        "Given a prototyping use case, returns structured candidate products per role (controller, per-requirement " +
        "peripherals), a compatibility matrix between them, and one mechanically-assembled cheapest bundle as a baseline. " +
        "This tool provides CANDIDATE DATA — you (the assistant) make the final recommendation using conversation context " +
        "(user's skill level, budget nuances, preferences). Verify stock with get_price_stock before presenting a shopping list.",
      inputSchema: suggestConfigurationInput,
    },
    async (args) => {
      const includeEol = args.include_eol;

      // --- controller candidates ---
      const controllerFilter = (p: NormalizedProduct) =>
        args.preferred_form === "any" || p.formFactor === FAMILY_TO_FORM[args.preferred_form];

      const controllerSearch = searchProducts(catalog.products, {
        query: args.use_case,
        category: "controller",
        includeEol,
        limit: 10,
      });
      // Blend: query-matched controllers first (specific use cases like "camera"
      // should surface specialized kits), then general-purpose defaults.
      const matched = controllerSearch.results.map((r) => r.product).filter(controllerFilter).slice(0, 3);
      const defaults = DEFAULT_CONTROLLERS.map((h) => catalog.byHandle.get(h))
        .filter((p): p is NormalizedProduct => !!p && (includeEol || !p.eol))
        .filter(controllerFilter)
        .filter((p) => !matched.some((m) => m.handle === p.handle));
      let controllers = [...matched, ...defaults].slice(0, 5);
      if (controllers.length === 0) {
        // preferred_form filtered everything out; fall back to any controller of that family
        controllers = catalog.products
          .filter((p) => p.category === "controller" && controllerFilter(p) && (includeEol || !p.eol))
          .sort((a, b) => a.priceRange.min - b.priceRange.min)
          .slice(0, 5);
      }

      // --- peripheral candidates per requirement ---
      const requirements = args.requirements?.length ? args.requirements : [args.use_case];
      const peripheralsByRequirement = requirements.map((requirement) => {
        const found = searchProducts(catalog.products, {
          query: requirement,
          includeEol,
          limit: 8,
        });
        const peripherals = found.results
          .map((r) => r.product)
          .filter((p) => p.category !== "controller" && p.category !== "kit")
          .slice(0, 3);
        return { requirement, candidates: peripherals.map(toSummary), _products: peripherals };
      });

      // --- compatibility matrix: each controller x each top peripheral ---
      const matrix = [];
      for (const controller of controllers) {
        for (const { requirement, _products } of peripheralsByRequirement) {
          const top = _products[0];
          if (!top) continue;
          const check = checkPair(controller, top, catalog.rules);
          matrix.push({
            controller: controller.handle,
            requirement,
            peripheral: top.handle,
            verdict: check.verdict,
            notes: check.notes,
          });
        }
      }

      // --- mechanically-assembled cheapest baseline bundle ---
      const budget = args.budget_usd;
      const cheapestController = [...controllers].sort((a, b) => a.priceRange.min - b.priceRange.min)[0];
      const bundleItems: NormalizedProduct[] = [];
      let allCompatible = true;
      if (cheapestController) {
        bundleItems.push(cheapestController);
        for (const { _products } of peripheralsByRequirement) {
          // Cheapest candidate that is verified compatible with the chosen
          // controller; fall back to the overall cheapest if none is.
          const byPrice = [..._products].sort((a, b) => a.priceRange.min - b.priceRange.min);
          const pick =
            byPrice.find((p) => checkPair(cheapestController, p, catalog.rules).verdict === "compatible") ??
            byPrice[0];
          if (!pick || bundleItems.some((i) => i.handle === pick.handle)) continue;
          bundleItems.push(pick);
          if (checkPair(cheapestController, pick, catalog.rules).verdict !== "compatible") {
            allCompatible = false;
          }
        }
      }
      const totalPrice = bundleItems.reduce((sum, p) => sum + p.priceRange.min, 0);

      return jsonResult(
        withDataAsOf(catalog, {
          interpretation: {
            use_case: args.use_case,
            requirements,
            preferred_form: args.preferred_form,
            budget_usd: budget ?? null,
          },
          candidates: {
            controllers: controllers.map(toSummary),
            by_requirement: peripheralsByRequirement.map(({ requirement, candidates }) => ({
              requirement,
              candidates,
            })),
          },
          compatibility_matrix: matrix,
          example_bundle: {
            items: bundleItems.map((p) => ({ handle: p.handle, title: p.title, priceUsd: p.priceRange.min })),
            total_price_usd: Math.round(totalPrice * 100) / 100,
            all_compatible: allCompatible,
            within_budget: budget === undefined ? null : totalPrice <= budget,
            note: "Cheapest mechanical baseline — refine using the full candidate lists above",
          },
          guidance_for_assistant:
            "These are candidates, not the answer. Pick per the user's context, explain trade-offs, " +
            "run check_compatibility on your final selection, and confirm stock with get_price_stock.",
        }),
      );
    },
  );
}
