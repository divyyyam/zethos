import { describe, expect, test } from "bun:test";
import {
  createPublicClient,
  custom,
  decodeFunctionData,
  encodeFunctionResult,
  erc20Abi,
  type Hex,
} from "viem";
import { createZethos, vaultAbi } from "../src/index.js";
import {
  ENGINE_URL,
  mockEngine,
  request,
  signer,
  statusBody,
  TAKER,
  VAULT,
  vaultQuoteBody,
} from "./fixtures.js";

const abi = [...vaultAbi, ...erc20Abi];

function liveChain(allowance: bigint) {
  const calls: string[] = [];
  const publicClient = createPublicClient({
    transport: custom({
      async request({ method, params }: { method: string; params?: [{ data: Hex }] }) {
        if (method === "eth_getCode") return "0x6080";
        if (method !== "eth_call" || !params) throw new Error(`unexpected ${method}`);
        const { functionName } = decodeFunctionData({ abi, data: params[0].data });
        calls.push(functionName);
        if (functionName === "quoteSigner") {
          return encodeFunctionResult({ abi: vaultAbi, functionName, result: signer.address });
        }
        if (functionName === "allowance") {
          return encodeFunctionResult({ abi: erc20Abi, functionName, result: allowance });
        }
        if (functionName === "approve") {
          return encodeFunctionResult({ abi: erc20Abi, functionName, result: true });
        }
        return "0x";
      },
    }),
  });
  return { publicClient, calls };
}

async function live(allowance: bigint) {
  const body = await vaultQuoteBody();
  const engine = mockEngine({
    "GET /status": () => statusBody({ mode: "live", verifyingContract: VAULT }),
    "POST /quote": () => body,
  });
  const chain = liveChain(allowance);
  const zethos = createZethos({
    engineUrl: ENGINE_URL,
    chainId: 133,
    fetch: engine.fetch,
    publicClient: chain.publicClient,
  });
  return { zethos, chain, quote: await zethos.quote(request) };
}

describe("buildFill (live)", () => {
  test("adds an exact-amount approve when the allowance is short", async () => {
    const { zethos, chain, quote } = await live(0n);
    const calls = await zethos.buildFill(quote, { account: TAKER });
    expect(calls.approve?.functionName).toBe("approve");
    expect(calls.approve?.args).toEqual([VAULT, 1000000n]);
    expect(calls.fill.address).toBe(VAULT);
    expect(chain.calls).toEqual(["quoteSigner", "allowance", "approve"]);
  });

  test("simulates fill directly when the allowance covers amountIn", async () => {
    const { zethos, chain, quote } = await live(1000000n);
    const calls = await zethos.buildFill(quote, { account: TAKER });
    expect(calls.approve).toBeUndefined();
    expect(calls.fill.functionName).toBe("fill");
    expect(chain.calls).toEqual(["quoteSigner", "allowance", "fill"]);
  });
});
