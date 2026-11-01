import { describe, expect, test } from "bun:test";
import { createZethos, verifyQuote as sdkVerify } from "@zethos/sdk";
import { quoteDomain, quoteTypes } from "@zethos/shared";
import { type Address, type Hex, hashTypedData, type PublicClient, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/api";
import { defaultParams, loadConfig } from "../src/config";
import { memoryStore } from "../src/db/memory";
import type { Engine } from "../src/engine";
import { checkVault, type LiveVault, routeKey, type VaultSnapshot } from "../src/live";
import { defaultMandate } from "../src/policy/mandate";
import { contractQuote } from "../src/quotes";
import { bookAround, MIDS, readyEngine, TAKER, tokens } from "./helpers";

const VAULT: Address = "0x8deB013d7A8f5f5C6C2d8fb12506fab506721d01";
const OWNER: Address = "0x369b982250D63D805849520d15f437B914BB2fe3";
const EXECUTOR: Address = "0x042208fF20630C91ddC7C10C77DE64224b0F2299";
const LIVE_KEY: Hex = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba";
const signer = privateKeyToAccount(LIVE_KEY);
const NOW = 1_800_000_000_000;
const USDT = tokens.USDT.address;
const WETH = tokens.WETH.address;

function snapshot(overrides: Partial<VaultSnapshot> = {}): VaultSnapshot {
  const enabled = { enabled: true, maxAmountIn: 50_000_000n };
  return {
    readAt: NOW,
    owner: OWNER,
    quoteSigner: signer.address,
    executor: EXECUTOR,
    paused: false,
    maxTtl: 120,
    routes: {
      [routeKey(USDT, WETH)]: enabled,
      [routeKey(WETH, USDT)]: { enabled: true, maxAmountIn: 20_000_000_000_000_000n },
      [routeKey(USDT, tokens.WHSK.address)]: enabled,
      [routeKey(tokens.WHSK.address, USDT)]: enabled,
    },
    balances: { USDT: 10_000_000_000n, WHSK: 50n * 10n ** 18n, WETH: 10n ** 18n },
    ...overrides,
  };
}

function vault(overrides: Partial<VaultSnapshot> = {}, read?: LiveVault["read"]): LiveVault {
  const initial = snapshot(overrides);
  return {
    vault: VAULT,
    signer,
    initial,
    read: read ?? (async (now) => ({ ...initial, readAt: now })),
  };
}

// At $3000, 25 tUSDT buys about 0.0083 WETH, so this covers one open quote and not two.
const thinVault = { USDT: 100_000_000n, WHSK: 0n, WETH: 10_000_000_000_000_000n };

function feed(engine: Engine, now: number) {
  for (const pair of defaultParams.pairs) {
    engine.ingest(
      pair,
      defaultParams.feeds.sources[pair].map((venue) => ({
        venue,
        book: bookAround(MIDS[pair], pair === "ETH/USDT" ? 50 : 1_000_000),
        error: null,
      })),
      now,
    );
  }
}

const buy = (amountIn = "25000000") => ({ taker: TAKER, tokenIn: USDT, tokenOut: WETH, amountIn });
const expectCode = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toMatchObject({ code });

describe("live config", () => {
  const env = {
    ENGINE_MODE: "live",
    CHAIN_ID: "133",
    HSK_RPC_URL: "https://testnet.hsk.xyz",
    CORS_ORIGIN: "http://localhost:3000",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    USDT_ADDRESS: USDT,
    WHSK_ADDRESS: tokens.WHSK.address,
    WETH_ADDRESS: WETH,
    VAULT_ADDRESS: VAULT,
    OPERATOR_ADDRESS: OWNER,
    QUOTE_SIGNER_KEY: LIVE_KEY,
    EXECUTOR_KEY: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  };

  test("accepts a complete testnet setup", () => {
    expect(loadConfig(env).live?.vault).toBe(VAULT);
  });

  test("stays on shadow by default", () => {
    expect(loadConfig({ ...env, ENGINE_MODE: "" }).live).toBeNull();
  });

  test("refuses mainnet", () => {
    expect(() => loadConfig({ ...env, CHAIN_ID: "177" })).toThrow("limited to CHAIN_ID=133");
  });

  for (const missing of ["VAULT_ADDRESS", "QUOTE_SIGNER_KEY", "EXECUTOR_KEY"]) {
    test(`requires ${missing}`, () => {
      expect(() => loadConfig({ ...env, [missing]: "" })).toThrow("requires VAULT_ADDRESS");
    });
  }

  test("refuses a shared key", () => {
    expect(() => loadConfig({ ...env, EXECUTOR_KEY: LIVE_KEY })).toThrow("must be distinct");
  });
});

describe("vault checks", () => {
  const expected = {
    vault: VAULT,
    chainId: 133,
    owner: OWNER,
    quoteSigner: signer.address,
    executor: EXECUTOR,
  };
  const probe = {
    taker: "0x0000000000000000000000000000000000000000",
    tokenIn: "0x0000000000000000000000000000000000000000",
    tokenOut: "0x0000000000000000000000000000000000000000",
    amountIn: "1",
    amountOut: "1",
    nonce: "0",
    issuedAt: "0",
    expiry: "1",
  } as const;
  const digest = hashTypedData({
    domain: { ...quoteDomain, chainId: 133, verifyingContract: VAULT },
    types: quoteTypes,
    primaryType: "Quote",
    message: contractQuote(probe),
  });
  const chain = (code: Hex | undefined, onChainDigest: Hex = digest) =>
    ({
      getCode: async () => code,
      readContract: async () => onChainDigest,
    }) as unknown as Pick<PublicClient, "getCode" | "readContract">;
  const reasons = async (
    client: ReturnType<typeof chain>,
    overrides: Partial<VaultSnapshot> = {},
  ) => (await checkVault(client, async () => snapshot(overrides), expected, NOW)).reasons;

  test("passes a matching vault", async () => {
    expect(await reasons(chain("0x60"))).toEqual([]);
  });

  test("fails without bytecode", async () => {
    expect(await reasons(chain("0x"))).toEqual(["No vault bytecode at VAULT_ADDRESS"]);
  });

  test("fails for a different signer, executor or owner", async () => {
    const other: Address = "0x1111111111111111111111111111111111111111";
    expect((await reasons(chain("0x60"), { quoteSigner: other }))[0]).toContain("quoteSigner");
    expect((await reasons(chain("0x60"), { executor: other }))[0]).toContain("executor");
    expect((await reasons(chain("0x60"), { owner: other }))[0]).toContain("owner");
  });

  test("fails when the vault hashes quotes differently", async () => {
    expect((await reasons(chain("0x60", `0x${"ab".repeat(32)}`)))[0]).toContain("quoteDigest");
  });

  test("a failed read throws instead of reporting a mismatch", async () => {
    const failing = async () => {
      throw new Error("rpc down");
    };
    await expect(checkVault(chain("0x60"), failing, expected, NOW)).rejects.toThrow("rpc down");
  });
});

describe("live quotes", () => {
  test("signs for the vault with the vault's signer, verifiable on the live route", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    const { response } = await engine.quote(buy(), "web", NOW);
    expect(response.route).toBe("conduit");
    if (response.route !== "conduit") throw new Error("expected a vault quote");
    expect(response.conduitOut).toBe(response.quote.amountOut);
    expect(response.hskswapOut).toBeNull();

    const publicClient = {
      getCode: async () => "0x60",
      readContract: async () => signer.address,
    } as unknown as PublicClient;
    const verification = await sdkVerify(response, buy(), {
      chainId: 177,
      status: { signer: signer.address, verifyingContract: VAULT },
      publicClient,
      now: NOW / 1000,
    });
    expect(verification).toEqual({ ok: true, trust: "chain", reasons: [] });

    const paperOnly = await sdkVerify(response, buy(), {
      chainId: 177,
      status: { signer: signer.address, verifyingContract: VAULT },
      publicClient: {
        ...publicClient,
        readContract: async () => privateKeyToAccount(`0x${"11".repeat(32)}`).address,
      } as unknown as PublicClient,
      now: NOW / 1000,
    });
    expect(paperOnly.reasons).toContain("bad_signer");
  });

  test("a live quote can never settle on the paper vault", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    const { response } = await engine.quote(buy(), "web", NOW);
    if (response.route !== "conduit") throw new Error("expected a vault quote");
    await expectCode(
      engine.paperFill({ quote: response.quote, signature: response.signature }, "web", NOW),
      "quote_invalid",
    );
  });

  test("stays within the route's cap", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    await engine.quote(buy("50000000"), "web", NOW);
    await expectCode(engine.quote(buy("50000001"), "web", NOW), "vault_capacity");
  });

  test("refuses a route the vault has off", async () => {
    const routes = {
      ...snapshot().routes,
      [routeKey(USDT, WETH)]: { enabled: false, maxAmountIn: 50_000_000n },
    };
    const { engine } = await readyEngine({ now: NOW, live: vault({ routes }) });
    await expectCode(engine.quote(buy(), "web", NOW), "pair_halted");
  });

  test("refuses while the vault is paused", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault({ paused: true }) });
    await expectCode(engine.quote(buy(), "web", NOW), "paused");
    expect(engine.status().paused).toBe(true);
  });

  test("never outlives the vault's maxTtl", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault({ maxTtl: 2 }) });
    const { response } = await engine.quote(buy(), "web", NOW);
    if (response.route !== "conduit") throw new Error("expected a vault quote");
    expect(BigInt(response.quote.expiry) - BigInt(response.quote.issuedAt)).toBe(2n);
  });

  test("has its own minimum, well below the paper one", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    const { response } = await engine.quote(buy("500000"), "web", NOW);
    expect(response.route).toBe("conduit");
    await expect(engine.quote(buy("499999"), "web", NOW)).rejects.toMatchObject({
      code: "invalid_request",
      message: "Minimum swap is $0.5",
    });
  });

  test("the paper minimum doesn't change", async () => {
    const { engine } = await readyEngine({ now: NOW });
    await engine.quote(buy("5000000"), "web", NOW);
    await expect(engine.quote(buy("4999999"), "web", NOW)).rejects.toMatchObject({
      code: "invalid_request",
      message: "Minimum swap is $5",
    });
  });

  test("stays open long enough for a person to confirm in a wallet", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    const { response } = await engine.quote(buy(), "web", NOW);
    expect(response.breakdown.ttlSec).toBe(60);
    expect(BigInt(response.quote.expiry) - BigInt(response.quote.issuedAt)).toBe(60n);
  });

  test("open quotes hold inventory until they expire", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault({ balances: thinVault }) });
    const { response } = await engine.quote(buy(), "web", NOW);
    await expectCode(engine.quote(buy(), "web", NOW), "vault_capacity");

    const later = (Number(response.quote.expiry) + 1) * 1000;
    feed(engine, later);
    expect((await engine.quote(buy(), "web", later)).response.route).toBe("conduit");
  });

  test("uses a recent snapshot and re-reads an old one", async () => {
    let reads = 0;
    const live = vault({}, async (now) => {
      reads += 1;
      return snapshot({ readAt: now });
    });
    const { engine } = await readyEngine({ now: NOW, live });
    await engine.quote(buy(), "web", NOW + 1_000);
    expect(reads).toBe(0);
    const later = NOW + 20_000;
    feed(engine, later);
    await engine.quote(buy(), "web", later);
    expect(reads).toBe(1);
  });

  test("refuses to quote when an old snapshot can't be refreshed", async () => {
    const down = vault({ readAt: NOW - 60_000 }, async () => {
      throw new Error("rpc down");
    });
    const { engine } = await readyEngine({ now: NOW, live: down });
    await expectCode(engine.quote(buy(), "web", NOW), "pair_halted");
  });

  test("the heartbeat refreshes on its cadence, and a failed read keeps the last snapshot", async () => {
    let reads = 0;
    const { engine } = await readyEngine({
      now: NOW,
      live: vault({}, async () => {
        reads += 1;
        throw new Error("rpc down");
      }),
    });
    await engine.syncLive(NOW + 5_000);
    expect(reads).toBe(0);
    await engine.syncLive(NOW + 11_000);
    expect(reads).toBe(1);
    expect(engine.status().mode).toBe("live");
  });

  test("a live quote leaves the paper books alone", async () => {
    const store = memoryStore();
    const { engine } = await readyEngine({ now: NOW, store, live: vault() });
    const before = engine.arenaView().equityUsd;
    await engine.quote(buy(), "web", NOW);
    expect(engine.arenaView().equityUsd).toBe(before);
    expect(await engine.fills(undefined, 10)).toEqual([]);
  });

  test("a restart keeps open quotes reserved", async () => {
    const store = memoryStore();
    const first = await readyEngine({ now: NOW, store, live: vault({ balances: thinVault }) });
    await first.engine.quote(buy(), "web", NOW);
    await first.engine.tick(NOW);
    const second = await readyEngine({ now: NOW, store, live: vault({ balances: thinVault }) });
    await expectCode(second.engine.quote(buy(), "web", NOW), "vault_capacity");
  });
});

describe("live status", () => {
  test("reports the vault, its balances and its routes", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    const status = engine.status();
    expect(status.mode).toBe("live");
    expect(status.verifyingContract).toBe(VAULT);
    expect(status.signer).toBe(signer.address);
    expect(status.inventory.WETH).toBe(String(10n ** 18n));
    const eth = status.pairs.find((pair) => pair.pair === "ETH/USDT");
    expect(eth?.vaultRoutes?.buy).toEqual({ enabled: true, maxAmountIn: "50000000" });
  });

  test("the real SDK accepts the live status and quote", async () => {
    const { engine } = await readyEngine({ live: vault({ readAt: Date.now() }) });
    const app = createApp({ engine: async () => engine, corsOrigins: [], waitUntil: () => {} });
    const zethos = createZethos({
      engineUrl: "http://engine.test",
      chainId: 177,
      client: "web",
      fetch: ((input: string | URL | Request, init?: RequestInit) =>
        app.request(String(input), init)) as typeof fetch,
    });
    expect((await zethos.status()).mode).toBe("live");
    const response = await zethos.quote(buy());
    expect(response.route).toBe("conduit");
  });

  test("shadow status is unchanged by the live fields", async () => {
    const { engine } = await readyEngine({ now: NOW });
    const status = engine.status();
    expect(status.mode).toBe("shadow");
    expect(status.liveBlocked).toEqual([]);
    expect(status.pairs[0]?.vaultRoutes).toBeNull();
  });

  test("a refused vault stays on paper, and says why", async () => {
    const reasons = ["vault.quoteSigner() is 0x1, not 0x2"];
    const { engine } = await readyEngine({ now: NOW, liveBlocked: reasons });
    expect((await engine.quote(buy(), "web", NOW)).response.route).toBe("paper");
    const status = engine.status();
    expect(status.mode).toBe("shadow");
    expect(status.verifyingContract).toBe(zeroAddress);
    expect(status.liveBlocked).toEqual(reasons);
    expect(engine.decisions(10, "live_blocked")[0]?.inputs.reasons).toBe(reasons[0]);
  });

  test("a live quote cannot leave the mandate", async () => {
    const { engine } = await readyEngine({
      now: NOW,
      live: vault(),
      mandate: {
        ...defaultMandate,
        service: {
          ...defaultMandate.service,
          maxHalfSpreadBps: [{ maxNotionalUsd: 50_000, maxBps: 0.01 }],
        },
      },
    });
    feed(engine, NOW);
    await expectCode(engine.quote(buy(), "web", NOW), "mandate_breach");
  });

  test("real fills come from vault events and stay off the paper books", async () => {
    const txHash = `0x${"ab".repeat(32)}` as const;
    const events = [
      {
        taker: TAKER,
        tokenIn: USDT,
        tokenOut: WETH,
        amountIn: 30_000_000n,
        amountOut: 10_000_000_000_000_000n,
        nonce: 7n,
        txHash,
        logIndex: 2,
        ts: NOW,
      },
    ];
    const { engine } = await readyEngine({
      now: NOW,
      live: { ...vault(), readFills: async () => events.splice(0) },
    });
    feed(engine, NOW);
    const paperBefore = engine.arenaView().equityUsd;

    const fills = await engine.fills(TAKER, 20);
    expect(fills).toHaveLength(1);
    expect(fills[0]).toMatchObject({
      paper: false,
      txHash,
      pair: "ETH/USDT",
      side: "buy",
      price: 3000,
    });
    expect(await engine.fills("0x000000000000000000000000000000000000dEaD", 20)).toHaveLength(0);
    expect(engine.arenaView().equityUsd).toBe(paperBefore);
    expect(engine.arenaView().byPolicy).toEqual({});
  });

  test("Arena quotes stay on paper while the engine is live, and fill on the paper books", async () => {
    const { engine } = await readyEngine({ now: NOW, live: vault() });
    const { response } = await engine.arenaQuote(buy(), "sniper/test", NOW);
    expect(response.route).toBe("paper");
    const fill = await engine.paperFill(
      { quote: response.quote, signature: response.signature },
      "sniper/test",
      NOW,
    );
    expect(fill).toMatchObject({ paper: true, flow: "attacker" });
    expect(engine.arenaView().byFlow).toBeDefined();
    expect(engine.arenaView().byPolicy.v0?.fills).toBe(1);
  });
});
