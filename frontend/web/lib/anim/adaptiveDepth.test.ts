import test from "node:test";
import assert from "node:assert/strict";
import { depthHelpLabel, requestDepthHelp } from "../adaptiveDepth";

test("optional depth help has a local per-board budget", () => {
  let state = {};
  const first = requestDepthHelp(state, "b1"); state = first.next;
  const second = requestDepthHelp(state, "b1"); state = second.next;
  const third = requestDepthHelp(state, "b1");
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(third.allowed, false);
  assert.equal(depthHelpLabel(state, "b1"), "Use Ask Aria for more help");
  assert.equal(requestDepthHelp(state, "b2").allowed, true, "a new board gets its own budget");
});
