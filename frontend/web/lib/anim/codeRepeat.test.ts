import test from "node:test";
import assert from "node:assert/strict";
import { codeSimilarity } from "../specBoardGen";

const countToFive = "count = 0\nwhile count < 5:\n    print(count)\n    count += 1";

test("the same loop shown again (even with a changed number) is a repeat", () => {
  assert.ok(codeSimilarity(countToFive, "count = 0\nwhile count < 10:\n    print(count)\n    count += 1") >= 0.7);
});

test("a genuinely different while loop is not a repeat", () => {
  const password = 'password = ""\nwhile password != "secret":\n    password = input("Password: ")\nprint("Welcome")';
  const sum = "total = 0\nn = 1\nwhile total < 100:\n    total += n\n    n += 1\nprint(n)";
  assert.ok(codeSimilarity(countToFive, password) < 0.7);
  assert.ok(codeSimilarity(countToFive, sum) < 0.7);
});

test("repeatsCode checks against every other board, the rule the worker enforces before saving", async () => {
  const { repeatsCode } = await import("../specBoardGen");
  const others = ["x = 1\nwhile x < 3:\n    x += 1", countToFive];
  assert.equal(repeatsCode("count = 0\nwhile count < 10:\n    print(count)\n    count += 1", others), true);
  assert.equal(repeatsCode('word = ""\nwhile word != "quit":\n    word = input("> ")', others), false);
});
