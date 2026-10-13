import test from "node:test";
import assert from "node:assert/strict";
import { dailyLimitUsd, isTracked, ledgerIncrease, spendDay, spendDocId, trackedEmails } from "../spendTracking";

/* The daily AI-spend watch for Hassan's and Minahil's accounts (lib/spendTracking.ts), 2026-10-13. */

test("only Hassan's and Minahil's accounts are tracked by default, matched without case", () => {
  assert.deepEqual(trackedEmails({}), ["hassankzr2006@gmail.com", "mrauf.bese23seecs@seecs.edu.pk"]);
  assert.equal(isTracked("HassanKzr2006@Gmail.com", {}), true);
  assert.equal(isTracked(" mrauf.bese23seecs@seecs.edu.pk ", {}), true);
  assert.equal(isTracked("someone.else@gmail.com", {}), false);
  assert.equal(isTracked("hassankzr2006+viewertest@gmail.com", {}), false, "a look-alike is not the account");
  assert.equal(isTracked("", {}), false);
  assert.equal(isTracked(null, {}), false);
  // The list is a setting: replacing it replaces the default.
  const env = { SPEND_TRACKED_EMAILS: "a@x.com, B@Y.com" };
  assert.deepEqual(trackedEmails(env), ["a@x.com", "b@y.com"]);
  assert.equal(isTracked("hassankzr2006@gmail.com", env), false);
});

test("the limit is $2.50 unless set", () => {
  assert.equal(dailyLimitUsd({}), 2.5);
  assert.equal(dailyLimitUsd({ SPEND_DAILY_LIMIT_USD: "0.05" }), 0.05);
  assert.equal(dailyLimitUsd({ SPEND_DAILY_LIMIT_USD: "nonsense" }), 2.5);
  assert.equal(dailyLimitUsd({ SPEND_DAILY_LIMIT_USD: "-1" }), 2.5);
});

test("the day turns over at midnight Pakistan time (UTC+5)", () => {
  assert.equal(spendDay(new Date("2026-10-13T18:59:59Z")), "2026-10-13", "23:59:59 PKT is still the 13th");
  assert.equal(spendDay(new Date("2026-10-13T19:00:00Z")), "2026-10-14", "00:00 PKT is the 14th");
  assert.equal(spendDay(new Date("2026-12-31T19:30:00Z")), "2027-01-01");
  assert.equal(spendDocId("u1", "2026-10-13"), "u1:2026-10-13");
});

test("a rise in the lecture's ledger is reported; a new lecture's reset is not", () => {
  assert.deepEqual(ledgerIncrease(0, 0.05), { reportUsd: 0.05, baseline: 0.05 });
  // generation's running total replaces the last one — still only the rise is new money
  const r = ledgerIncrease(0.05, 0.12);
  assert.ok(Math.abs(r.reportUsd - 0.07) < 1e-12);
  assert.equal(r.baseline, 0.12);
  assert.deepEqual(ledgerIncrease(0.12, 0.12), { reportUsd: 0, baseline: 0.12 }, "no change, nothing sent");
  assert.deepEqual(ledgerIncrease(0.4, 0), { reportUsd: 0, baseline: 0 }, "a new lecture starts at zero");
  assert.deepEqual(ledgerIncrease(0, 0.02), { reportUsd: 0.02, baseline: 0.02 }, "and its first cost counts");
  assert.deepEqual(ledgerIncrease(0.3, Number.NaN), { reportUsd: 0, baseline: 0.3 }, "a broken total changes nothing");
});

test("a Pakistan day covers 19:00 UTC the day before to 19:00 UTC that day", async () => {
  const { spendDayRange } = await import("../spendTracking");
  assert.deepEqual(spendDayRange("2026-10-13"), { from: "2026-10-12T19:00:00.000Z", to: "2026-10-13T19:00:00.000Z" });
});
