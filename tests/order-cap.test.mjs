import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { orderCapReached, orderCountKey, staleOrderCountKeys, MAX_ORDERS_PER_DAY } from "../hosted/src/order-cap.js";

const day = Date.UTC(2026, 10, 3, 23, 30, 0);

test("order cap key is the UTC date and rolls at midnight", () => {
  assert.equal(orderCountKey(day), "ordercount:2026-11-03");
  assert.equal(orderCountKey(Date.UTC(2026, 10, 3, 23, 59, 59)), "ordercount:2026-11-03");
  assert.equal(orderCountKey(Date.UTC(2026, 10, 4, 0, 0, 0)), "ordercount:2026-11-04");
});

test("order cap opens until 5000 creations that UTC day", () => {
  assert.equal(MAX_ORDERS_PER_DAY, 5000);
  assert.equal(orderCapReached(0), false);
  assert.equal(orderCapReached(4999), false);
  assert.equal(orderCapReached(5000), true);
  assert.equal(orderCapReached(undefined), false);
});

test("stale order counters are every UTC day except today", () => {
  const keys = ["ordercount:2026-11-02", "ordercount:2026-11-03", "ai:2026-11-02", "MOCK-1"];
  assert.deepEqual(staleOrderCountKeys(keys, day), ["ordercount:2026-11-02"]);
});

test("hosted worker uses the UTC day counter and not a live-order count", async () => {
  const src = await readFile(new URL("../hosted/src/index.js", import.meta.url), "utf8");
  assert.match(src, /orderCountKey\(/);
  assert.match(src, /orderCapReached\(/);
  assert.match(src, /staleOrderCountKeys\(/);
  assert.match(src, /Try again tomorrow/);
  assert.doesNotMatch(src, /meta:count/);
});
