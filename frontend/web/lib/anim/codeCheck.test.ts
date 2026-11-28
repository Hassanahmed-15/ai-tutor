import { test } from "node:test";
import assert from "node:assert/strict";
import { pythonListingFault } from "../canvas/codeCheck";

test("a Python listing that is not Python is a fault; a whole one, or pseudocode, is not (QA report 2026-11-27)", async (t) => {
  const whole = ["def binary_search(a, target):", "    low, high = 0, len(a) - 1", "    while low <= high:", "        mid = (low + high) // 2", "        if a[mid] == target:", "            return mid", "        if a[mid] < target:", "            low = mid + 1", "        else:", "            high = mid - 1", "    return -1"];
  const probe = await pythonListingFault(["def f(:", "  x", "y"]);
  if (probe === null) return t.skip("no Python on this machine (set PDF_PYTHON_BINARY)");
  assert.equal(await pythonListingFault(whole), null);
  const noDef = [...whole.slice(0, 6), "    while low <= high:", "        mid = (low + high) // 2", "            return mid"];
  assert.match((await pythonListingFault(noDef)) ?? "", /not valid Python \(line \d+/);
  assert.equal(await pythonListingFault(["INPUT x", "IF x > 0 THEN", "  OUTPUT x", "ENDIF"]), null);
});
