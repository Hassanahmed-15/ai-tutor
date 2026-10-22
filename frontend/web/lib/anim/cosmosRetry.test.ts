import test from "node:test";
import assert from "node:assert/strict";
import { retryStalled } from "../db/cosmos";

const timeout = () => Object.assign(new Error("Timeout Error! Request took more than 10000 ms"), { code: "TimeoutError" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ctx = (extra: Record<string, unknown> = {}) => ({ method: "POST", path: "/dbs/x/colls/y/docs", ...extra }) as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const node = {} as any;

test("a stalled Cosmos request is sent once more instead of waited out", async () => {
  let calls = 0;
  const res = await retryStalled(ctx(), node, async () => {
    calls++;
    if (calls === 1) throw timeout();
    return { headers: {}, result: { ok: true }, code: 200 };
  });
  assert.equal(calls, 2);
  assert.deepEqual(res.result, { ok: true });
});

test("a create whose first try landed (409 on the retry) counts as created", async () => {
  let calls = 0;
  const res = await retryStalled(ctx({ operationType: "create", body: JSON.stringify({ id: "s1" }) }), node, async () => {
    calls++;
    if (calls === 1) throw timeout();
    throw Object.assign(new Error("Conflict"), { code: 409 });
  });
  assert.equal(res.code, 201);
  assert.deepEqual(res.result, { id: "s1" });
});

test("other errors are not retried, and a second stall is reported", async () => {
  let calls = 0;
  await assert.rejects(retryStalled(ctx(), node, async () => { calls++; throw Object.assign(new Error("Not found"), { code: 404 }); }), /Not found/);
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(retryStalled(ctx(), node, async () => { calls++; throw timeout(); }), /Timeout/);
  assert.equal(calls, 2);
});
