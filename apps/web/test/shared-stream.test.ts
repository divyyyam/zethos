import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamHandlers } from "@zethos/sdk";
import { sharedStream } from "../src/lib/engine/shared-stream";

test("the shell and Agent share one socket and both receive outage frames", () => {
  let connections = 0;
  let closes = 0;
  let handlers: StreamHandlers = {};
  const subscribe = sharedStream((h) => {
    handlers = h;
    connections++;
    return () => {
      closes++;
    };
  });
  const frames: unknown[] = [];
  const first = subscribe({ price: (frame) => frames.push(frame) });
  const second = subscribe({ price: (frame) => frames.push(frame) });
  assert.equal(connections, 1);
  handlers.price?.({ type: "price", pair: "HSK/USDT", mid: null, health: "down", ts: 1 });
  assert.equal(frames.length, 2);
  first();
  assert.equal(closes, 0);
  second();
  assert.equal(closes, 1);
});
