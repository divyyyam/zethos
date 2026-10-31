import { expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { defaultParams, loadConfig, paramsSchema } from "../src/config";
import { readyEngine } from "./helpers";

const env = {
  CHAIN_ID: "177",
  HSK_RPC_URL: "https://mainnet.hsk.xyz",
  CORS_ORIGIN: "http://localhost:3000",
};
test("config refuses live mode, duplicate identities, weak sessions and non-exact origins", () => {
  const key = generatePrivateKey();
  expect(() => loadConfig({ ...env, ENGINE_MODE: "live" })).toThrow();
  expect(() => loadConfig({ ...env, PAPER_SIGNER_KEY: key, EXECUTOR_KEY: key })).toThrow(
    "distinct",
  );
  expect(() =>
    loadConfig({
      ...env,
      PAPER_SIGNER_KEY: key,
      OPERATOR_ADDRESS: privateKeyToAccount(key).address,
      SESSION_SECRET: "test-session-secret-with-32-characters",
    }),
  ).toThrow("distinct");
  expect(() => loadConfig({ ...env, OPERATOR_ADDRESS: privateKeyToAccount(key).address })).toThrow(
    "SESSION_SECRET",
  );
  expect(() => loadConfig({ ...env, CORS_ORIGIN: "https://example.test/path" })).toThrow("exact");
  expect(loadConfig(env).operator).toBeNull();
});
test("invalid strategy reload keeps the prior params and no decision is fabricated", async () => {
  const { engine, now } = await readyEngine();
  const invalid = structuredClone(defaultParams);
  invalid.inventory.minShare = 0.9;
  expect(paramsSchema.safeParse(invalid).success).toBe(false);
  await expect(engine.reloadParams(invalid, now)).rejects.toMatchObject({
    code: "invalid_request",
  });
  expect(engine.decisions()).toHaveLength(0);
  const valid = structuredClone(defaultParams);
  valid.spread.base["HSK/USDT"] = 0.003;
  await engine.reloadParams(valid, now);
  expect(engine.decisions()[0]?.type).toBe("param_reload");
  expect(engine.status().pairs[0]?.halfSpread?.buy).toBeGreaterThan(0.003);
});
