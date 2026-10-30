import { expect, test } from "bun:test";
import { createZethos, vaultAbi } from "@zethos/sdk";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  type Hex,
} from "viem";
import { z } from "zod";
import {
  mockEngine,
  signer,
  statusBody,
  TAKER,
  VAULT,
  vaultQuoteBody,
} from "../../../packages/sdk/test/fixtures";
import { loadConfig } from "../src/config";
import { TradingService } from "../src/service";
import { Ledger } from "../src/store";

test("live tools verify genuine signatures and return exact unsigned calls without broadcasting", async () => {
  const quote = await vaultQuoteBody();
  const engine = mockEngine({
    "GET /status": () => statusBody({ mode: "live", verifyingContract: VAULT }),
    "POST /quote": () => quote,
  });
  const methods: string[] = [];
  const publicClient = createPublicClient({
    transport: custom({
      async request({ method, params }: { method: string; params?: [{ data: Hex }] }) {
        methods.push(method);
        if (method === "eth_getCode") return "0x6080";
        if (method !== "eth_call" || !params) throw new Error(`Unexpected RPC ${method}`);
        const { functionName } = decodeFunctionData({
          abi: [...vaultAbi, ...erc20Abi],
          data: params[0].data,
        });
        if (functionName === "quoteSigner")
          return encodeFunctionResult({ abi: vaultAbi, functionName, result: signer.address });
        if (functionName === "allowance")
          return encodeFunctionResult({ abi: erc20Abi, functionName, result: 0n });
        if (functionName === "approve")
          return encodeFunctionResult({ abi: erc20Abi, functionName, result: true });
        return "0x";
      },
    }),
  });
  const config = loadConfig({
    ZETHOS_CHAIN_ID: "133",
    ZETHOS_TAKER_ADDRESS: TAKER,
    ZETHOS_DAILY_NOTIONAL_USD: "1",
    MCP_STATE_PATH: ":memory:",
  });
  const sdk = createZethos({
    engineUrl: config.engineUrl,
    chainId: 133,
    client: "mcp",
    fetch: engine.fetch,
    publicClient,
  });
  const ledger = new Ledger(":memory:", "live");
  const service = new TradingService(sdk, config, ledger);
  try {
    const result = await service.call("get_quote", { pair: "HSK/USDT", side: "buy", amount: "1" });
    expect(result.isError).toBeUndefined();
    const quoteId = result.data.quoteId;
    const built = await service.call("build_fill_tx", { quoteId });
    expect(built).toMatchObject({ data: { paper: false, submitted: false, chainId: 133 } });
    const { transactions } = z
      .object({
        transactions: z.array(
          z.object({ to: z.string(), data: z.custom<Hex>(), value: z.literal("0") }),
        ),
      })
      .parse(built.data);
    expect(transactions).toHaveLength(2);
    const [approve, fill] = transactions;
    if (!approve || !fill) throw new Error("Missing unsigned transactions");
    expect(decodeFunctionData({ abi: erc20Abi, data: approve.data })).toMatchObject({
      functionName: "approve",
      args: [VAULT, 1000000n],
    });
    expect(decodeFunctionData({ abi: vaultAbi, data: fill.data })).toMatchObject({
      functionName: "fill",
    });
    const before = methods.length;
    expect(await service.call("execute_swap", { quoteId, confirm: true })).toEqual(built);
    expect(methods).toHaveLength(before);
    expect(methods.every((m) => m === "eth_getCode" || m === "eth_call")).toBe(true);
    const second = await service.call("get_quote", { pair: "HSK/USDT", side: "buy", amount: "1" });
    expect(await service.call("build_fill_tx", { quoteId: second.data.quoteId })).toMatchObject({
      isError: true,
      data: { error: "daily_limit" },
    });
  } finally {
    ledger.close();
  }
});
