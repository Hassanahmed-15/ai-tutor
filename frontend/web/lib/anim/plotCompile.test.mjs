import test from "node:test";
import assert from "node:assert/strict";
import * as vegaLite from "vega-lite";

import plotSpec from "../../.test-build/lib/plotSpec.js";

/**
 * The ESM half of the suite, and it exists for exactly one module.
 *
 * vega-lite is an async ES module (top-level await), so `require()` of it throws
 * ERR_REQUIRE_ASYNC_MODULE — it cannot be reached from the CommonJS test build where every other
 * test runs. That build still checks the structural validator; this file checks the claim that
 * actually matters: a spec we accept is a spec Vega-Lite can compile.
 *
 * `compilesAsVegaLite` takes an injectable loader for precisely this reason.
 */

const { validatePlotSpec, compilesAsVegaLite } = plotSpec;
const load = async () => vegaLite;

const GOOD = {
  mark: "line",
  data: { values: [{ year: 1, amount: 1050 }, { year: 2, amount: 1102 }] },
  encoding: {
    x: { field: "year", type: "quantitative" },
    y: { field: "amount", type: "quantitative" },
  },
};

test("a spec that passes both checks really does compile", async () => {
  const spec = validatePlotSpec(GOOD);
  assert.ok(spec);
  assert.equal(await compilesAsVegaLite(spec, load), true);
});

test("structural validation alone is not enough — the compiler catches what it cannot", async () => {
  // `sideways` is not a Vega-Lite measurement type. Nothing about the spec's SHAPE is wrong, so
  // the structural pass has no opinion; only compile() knows. That gap is the whole reason the
  // generator runs both before it will show a chart.
  const bogus = validatePlotSpec({
    ...GOOD,
    encoding: { x: { field: "year", type: "sideways" }, y: { field: "amount", type: "quantitative" } },
  });
  assert.ok(bogus, "structurally this looks fine");
  assert.equal(await compilesAsVegaLite(bogus, load), false, "and semantically it is not");
});

test("a loader that throws degrades to 'not renderable', never to a crash", async () => {
  const spec = validatePlotSpec(GOOD);
  assert.equal(
    await compilesAsVegaLite(spec, async () => {
      throw new Error("module missing");
    }),
    false,
  );
});
