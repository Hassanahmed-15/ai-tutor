/** Print the Phase 0 paid-call estimate. Does not call any API. */
import { estimatePhase0Usd } from "../../lib/bench/cost.ts";

const e = estimatePhase0Usd();
console.log(JSON.stringify(e, null, 2));
console.log(`\nPhase 0 cap $${e.capUsd}. Estimated total $${e.totalUsd}. ${e.withinCap ? "Within cap." : "OVER CAP — do not run."}`);
console.log("Reply yes to this estimate before any paid generation or judge calls.");
