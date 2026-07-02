import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Catalog } from "../data/loader.js";
import { checkPair } from "../lib/compatibility.js";
import { checkCompatibilityInput } from "../schemas.js";
import { jsonResult, resolveOrError, withDataAsOf } from "./helpers.js";

export function registerCheckCompatibility(server: McpServer, catalog: Catalog): void {
  server.registerTool(
    "check_compatibility",
    {
      title: "Check M5Stack product compatibility",
      description:
        "Check whether peripherals (Units, Modules, Hats, Atomic bases) physically/electrically fit a given controller. " +
        "Returns a verdict per peripheral with confidence, the basis of the judgement, required extras and caveats. " +
        "Treat 'unknown' verdicts as 'check the linked docs', not as incompatible.",
      inputSchema: checkCompatibilityInput,
    },
    async (args) => {
      const controllerResolved = resolveOrError(catalog, args.controller);
      if ("error" in controllerResolved) return jsonResult(withDataAsOf(catalog, controllerResolved));
      const controller = controllerResolved.product;

      if (controller.category !== "controller") {
        return jsonResult(
          withDataAsOf(catalog, {
            error: `"${controller.title}" (${controller.handle}) is a ${controller.category}, not a controller. Pass the controller first, peripherals second.`,
          }),
        );
      }

      const results = [];
      const errors = [];
      for (const identifier of args.peripherals) {
        const resolved = resolveOrError(catalog, identifier);
        if ("error" in resolved) {
          errors.push({ identifier, ...resolved });
          continue;
        }
        results.push(checkPair(controller, resolved.product, catalog.rules));
      }

      const verdicts = results.map((r) => r.verdict);
      const overall = verdicts.every((v) => v === "compatible")
        ? "all compatible"
        : verdicts.some((v) => v === "incompatible")
          ? "some peripherals are incompatible"
          : "check the conditional/unknown items";

      return jsonResult(
        withDataAsOf(catalog, {
          controller: { handle: controller.handle, title: controller.title, formFactor: controller.formFactor },
          results,
          errors,
          overall,
        }),
      );
    },
  );
}
