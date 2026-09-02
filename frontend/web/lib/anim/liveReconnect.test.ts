/**
 * When a dropped Live session is allowed to come back, and when it must stay down.
 *
 * The socket itself cannot be unit tested, but the recovery POLICY is the part that was wrong and
 * it is ordinary data: which close codes are worth retrying, how long to wait, and how many times.
 *
 * THE BUG THIS COVERS. Every close was terminal — `onclose` tore the session down and nothing
 * dialled again — so a lesson build, which runs four to six minutes and outlasts a Live session,
 * routinely left the student with a dead microphone. The evidence was in the dev log: twenty
 * separate token mints inside one planning session, each one a student pressing the button after a
 * silent drop.
 *
 * The two ways to get this wrong are opposite, so both are pinned here: never reconnecting (the
 * original bug) and reconnecting when the session was meant to end (a resurrected conversation the
 * student stopped, still billing).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const hook = readFileSync(join(process.cwd(), "lib", "useGeminiLiveTutor.ts"), "utf8");

test("a dropped session is retried with growing backoff", () => {
  const delays = hook.match(/const RECONNECT_DELAYS_MS = \[([^\]]+)\]/);
  assert.ok(delays, "RECONNECT_DELAYS_MS must exist — without it a drop is permanent");

  const values = delays[1].split(",").map((n) => Number(n.replace(/_/g, "").trim()));
  assert.ok(values.length >= 3, "one or two attempts is not meaningful recovery");
  for (let i = 1; i < values.length; i++) {
    assert.ok(
      values[i] > values[i - 1],
      `delays must grow so a refusing server is not hammered: ${values.join(", ")}`,
    );
  }
  assert.ok(values[0] <= 2000, "the first retry should be quick — the student is mid-conversation");
});

test("hopeless closes are not retried", () => {
  /*
   * 1008 is a policy close: denied access, revoked key, exhausted quota. Retrying it produces the
   * same refusal five more times while telling the student it is reconnecting, which is worse than
   * the blunt error, because it hides a misconfiguration behind a hopeful spinner.
   */
  const fatal = hook.match(/const FATAL_CLOSE_CODES = new Set\(\[([^\]]+)\]\)/);
  assert.ok(fatal, "FATAL_CLOSE_CODES must exist");
  const codes = fatal[1].split(",").map((n) => Number(n.trim()));
  assert.ok(codes.includes(1008), "a policy close must not be retried");
  assert.ok(codes.includes(1000), "a normal close is the session ending, not a failure");
  // 1006/1011 are exactly what recovery is for and must NOT be in the fatal set.
  assert.ok(!codes.includes(1006), "an abnormal close is the main case worth recovering from");
  assert.ok(!codes.includes(1011), "a server error should be retried, not surfaced as fatal");
});

test("only sessions meant to stay up recover", () => {
  /*
   * `alwaysOn` marks the sessions whose whole purpose is surviving a long wait. A session that
   * ended because the student stopped it, went idle, or hit its cap must stay ended — otherwise
   * stopping the tutor brings it back a second later, still billing.
   */
  assert.match(
    hook,
    /const scheduleReconnect = useCallback\([\s\S]{0,400}?if \(!optionsRef\.current\.alwaysOn\) return false;/,
    "scheduleReconnect must refuse non-alwaysOn sessions before anything else",
  );
});

test("an explicit stop cancels a pending reconnect", () => {
  // Otherwise the student presses stop, the timer fires a second later, and the session returns.
  assert.match(
    hook,
    /if \(reconnectTimerRef\.current\) clearTimeout\(reconnectTimerRef\.current\)/,
    "clearTimers must cancel the reconnect timer",
  );
  assert.match(
    hook,
    /const stop = useCallback\(\(\) => \{[\s\S]{0,300}?reconnectCountRef\.current = 0;/,
    "stop() must reset the recovery budget",
  );
});

test("a healthy connection restores the recovery budget", () => {
  /*
   * Without this the counter only climbs, so a long session that dropped and fully recovered four
   * times would refuse the fifth. The budget exists to stop a hopeless retry loop, not to ration a
   * healthy session.
   */
  assert.match(
    hook,
    /reconnectCountRef\.current = 0;\s*\n\s*setReconnecting\(false\);\s*\n\s*\n?\s*if \(!optionsRef\.current\.alwaysOn\)/,
    "a successful connect must reset the reconnect counter",
  );
});

test("recovery is reported as reconnecting, never as a plain error", () => {
  // A drop that is about to be fixed must not read as a dead session to the student.
  assert.match(hook, /reconnecting,/, "the hook must expose a reconnecting flag");
  assert.match(
    hook,
    /setErrorMessage\(\s*recovering\s*\?\s*null/,
    "while recovering, the error message must be cleared rather than shown",
  );
});
