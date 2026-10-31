import { beforeEach, describe, expect, test } from "bun:test";
import {
  backoffDelay,
  createZethos,
  type StreamFrame,
  subscribe,
  type ZethosError,
} from "../src/index.js";
import { fillBody } from "./fixtures.js";

class FakeSocket {
  static instances: FakeSocket[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  open() {
    this.onopen?.({});
  }

  send(frame: unknown) {
    this.onmessage?.({ data: typeof frame === "string" ? frame : JSON.stringify(frame) });
  }

  drop() {
    this.onclose?.({});
  }

  close() {
    this.closed = true;
    this.onclose?.({});
  }
}

const FakeWebSocket = FakeSocket as unknown as typeof WebSocket;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const latest = () => FakeSocket.instances.at(-1) as FakeSocket;

beforeEach(() => {
  FakeSocket.instances = [];
});

describe("stream", () => {
  test("backoff doubles from 0.5 s and caps at 15 s", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => backoffDelay(n))).toEqual([
      500, 1000, 2000, 4000, 8000, 15000, 15000,
    ]);
  });

  test("dispatches typed frames and reports invalid ones", () => {
    const seen: StreamFrame[] = [];
    const errors: ZethosError[] = [];
    const stop = subscribe({
      url: "ws://engine/stream",
      WebSocket: FakeWebSocket,
      handlers: {
        price: (frame) => seen.push(frame),
        fill: (frame) => seen.push(frame),
        onError: (error) => errors.push(error),
      },
    });
    const socket = latest();
    socket.open();
    socket.send({ type: "price", pair: "HSK/USDT", mid: 0.5, health: "ok", ts: 1 });
    socket.send({ type: "fill", fill: fillBody() });
    socket.send({ type: "risk", paused: false, riskState: "normal", halted: [] });
    socket.send({ type: "price", pair: "HSK/USDT", mid: "0.5", health: "ok", ts: 1 });
    socket.send("not json");
    expect(seen.map((f) => f.type)).toEqual(["price", "fill"]);
    expect(errors.map((e) => e.code)).toEqual(["invalid_response", "invalid_response"]);
    stop();
  });

  test("reconnects with growing delays, resets after a successful open, and stops on unsubscribe", async () => {
    let opens = 0;
    const stop = subscribe({
      url: "ws://engine/stream",
      WebSocket: FakeWebSocket,
      handlers: { onOpen: () => opens++ },
      minDelayMs: 10,
      maxDelayMs: 40,
    });
    latest().drop();
    await sleep(5);
    expect(FakeSocket.instances).toHaveLength(1);
    await sleep(15);
    expect(FakeSocket.instances).toHaveLength(2);

    latest().drop();
    await sleep(15);
    expect(FakeSocket.instances).toHaveLength(2);
    await sleep(15);
    expect(FakeSocket.instances).toHaveLength(3);

    latest().open();
    latest().drop();
    await sleep(20);
    expect(FakeSocket.instances).toHaveLength(4);
    expect(opens).toBe(1);

    stop();
    expect(latest().closed).toBe(true);
    await sleep(60);
    expect(FakeSocket.instances).toHaveLength(4);
  });

  test("client.stream connects to the ws(s) URL of the engine", () => {
    const zethos = createZethos({
      engineUrl: "https://engine.example.test/",
      chainId: 133,
      WebSocket: FakeWebSocket,
    });
    const stop = zethos.stream({});
    expect(latest().url).toBe("wss://engine.example.test/stream");
    stop();
  });

  test("delivers feed outages, parameter reloads and fills with unknown reference prices", () => {
    const seen: StreamFrame[] = [];
    const errors: ZethosError[] = [];
    const stop = subscribe({
      url: "ws://engine/stream",
      WebSocket: FakeWebSocket,
      handlers: {
        price: (f) => seen.push(f),
        params: (f) => seen.push(f),
        fill: (f) => seen.push(f),
        onError: (e) => errors.push(e),
      },
    });
    latest().send({ type: "price", pair: "HSK/USDT", mid: null, health: "down", ts: 1 });
    latest().send({ type: "params", ts: 1, changed: ["spread"] });
    latest().send({ type: "fill", fill: { ...fillBody(), midAtFill: null } });
    expect(seen.map((f) => f.type)).toEqual(["price", "params", "fill"]);
    expect(errors).toEqual([]);
    stop();
  });
});
