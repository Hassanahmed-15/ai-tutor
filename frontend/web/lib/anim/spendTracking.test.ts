import test from "node:test";
import assert from "node:assert/strict";
import { dailyLimitUsd, isTracked, spendDay, trackedEmails } from "../spendTracking";

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
});

test("a Pakistan day covers 19:00 UTC the day before to 19:00 UTC that day", async () => {
  const { spendDayRange } = await import("../spendTracking");
  assert.deepEqual(spendDayRange("2026-10-13"), { from: "2026-10-12T19:00:00.000Z", to: "2026-10-13T19:00:00.000Z" });
});
