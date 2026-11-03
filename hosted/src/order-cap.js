// Cap on new mock orders for the public demo.
// The counter key is the UTC date, so it resets at 00:00 UTC. That is what
// "Try again tomorrow" means. Stored orders are still deleted by the alarm
// once they are a day old, which keeps the Durable Object from filling up.
export const MAX_ORDERS_PER_DAY = 5000;
export const ORDER_COUNT_PREFIX = "ordercount:";

export function orderCountKey(now = Date.now()) {
  return ORDER_COUNT_PREFIX + new Date(now).toISOString().slice(0, 10);
}

export function orderCapReached(made) {
  return (Number(made) || 0) >= MAX_ORDERS_PER_DAY;
}

export function staleOrderCountKeys(keys, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  return keys.filter((key) => {
    return typeof key === "string" && key.startsWith(ORDER_COUNT_PREFIX) && key.slice(ORDER_COUNT_PREFIX.length) !== today;
  });
}
