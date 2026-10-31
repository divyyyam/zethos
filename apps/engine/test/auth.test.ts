import { describe, expect, test } from "bun:test";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { createApp } from "../src/api";
import { type AuthStorage, OperatorAuth } from "../src/auth";
import { readyEngine } from "./helpers";

const owner = privateKeyToAccount(generatePrivateKey());
const origin = "https://web.example.test";
const now = Date.now();
const options = {
  operator: owner.address,
  secret: "local-test-session-secret-32-bytes-minimum",
  origins: [origin],
  chainId: 177,
};
async function login(
  auth: OperatorAuth,
  patch: Partial<Parameters<typeof createSiweMessage>[0]> = {},
  at = now,
) {
  const nonce = await auth.nonce(at);
  const message = createSiweMessage({
    address: owner.address,
    chainId: 177,
    domain: "web.example.test",
    uri: origin,
    version: "1",
    nonce,
    issuedAt: new Date(at),
    expirationTime: new Date(at + 60000),
    ...patch,
  });
  return { message, signature: await owner.signMessage({ message }) };
}

describe("operator authentication", () => {
  test("binds address, origin, chain, expiry and a single-use nonce", async () => {
    const auth = new OperatorAuth(options);
    const body = await login(auth);
    const session = await auth.verify(body, now);
    expect(await auth.require(session.token, now)).toBe(owner.address);
    await expect(auth.verify(body, now)).rejects.toMatchObject({ code: "unauthorized" });
    await expect(auth.require(session.token, now + 60001)).rejects.toMatchObject({
      code: "unauthorized",
    });
    for (const patch of [
      { chainId: 133 },
      { domain: "evil.example.test" },
      { uri: "https://evil.example.test" },
      { expirationTime: new Date(now + 86400001) },
      { address: "0x1111111111111111111111111111111111111111" as const },
    ]) {
      await expect(auth.verify(await login(auth, patch), now)).rejects.toMatchObject({
        code: "unauthorized",
      });
    }
  });
  test("persists sessions, consumes nonces once under concurrency, and revokes logout", async () => {
    let saved: Parameters<AuthStorage["save"]>[0] | null = null;
    const storage: AuthStorage = {
      load: async () => saved,
      save: async (state) => {
        saved = structuredClone(state);
      },
    };
    const auth = new OperatorAuth({ ...options, storage });
    const body = await login(auth);
    const results = await Promise.allSettled([auth.verify(body, now), auth.verify(body, now)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const first = results[0];
    if (first?.status !== "fulfilled") throw new Error("first login failed");
    const restored = new OperatorAuth({ ...options, storage });
    expect(await restored.require(first.value.token, now)).toBe(owner.address);
    await restored.logout(first.value.token);
    await expect(restored.require(first.value.token, now)).rejects.toMatchObject({
      code: "unauthorized",
    });
  });
  test("HTTP controls require a cookie and reject untrusted origins", async () => {
    const auth = new OperatorAuth(options);
    const { engine } = await readyEngine({ now });
    const app = createApp({
      engine: async () => engine,
      auth: async () => auth,
      corsOrigins: [origin],
      waitUntil: () => {},
    });
    expect((await app.request("/operator/pause", { method: "POST" })).status).toBe(401);
    const session = await auth.verify(await login(auth), Date.now());
    const headers = { Cookie: `zethos_session=${session.token}`, Origin: origin };
    expect((await app.request("/operator/pause", { method: "POST", headers })).status).toBe(200);
    expect(engine.status().paused).toBe(true);
    expect(
      (
        await app.request("/operator/resume", {
          method: "POST",
          headers: { ...headers, Origin: "https://evil.example.test" },
        })
      ).status,
    ).toBe(403);
    expect((await app.request("/operator/resume", { method: "POST", headers })).status).toBe(200);
    expect(engine.status().paused).toBe(false);
    const pnl = await app.request("/pnl?period=all", { headers });
    expect(pnl.status).toBe(200);
  });
});
