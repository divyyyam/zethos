/**
 * bun run scripts/demo-check.ts
 * Optional: DEMO_WEB_URL, DEMO_ENGINE_URL, DEMO_BROWSER_PATH, DEMO_TAKER_ADDRESS.
 * Uses local servers only. Every wallet send is declined; network RPC sends are blocked.
 */
import { strict as assert } from "node:assert";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "playwright-core";

const webUrl = process.env.DEMO_WEB_URL ?? "http://localhost:3000";
const engineUrl = process.env.DEMO_ENGINE_URL ?? "http://localhost:8787";
const failures: string[] = [];
let passed = 0;
let browser: Browser | undefined;
let page: Page;

declare global {
  interface Window {
    zethosDemoRequests: string[];
  }
}

async function step(name: string, action: () => Promise<void>) {
  console.log(`RUN  ${name}`);
  try {
    await action();
    passed++;
    console.log(`PASS ${name}`);
  } catch (error) {
    failures.push(name);
    if (page) {
      const alerts = await page
        .getByRole("alert")
        .allTextContents()
        .catch(() => []);
      if (alerts.length) console.error(`Observed alerts: ${alerts.join(" | ")}`);
    }
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : "Unknown failure"}`);
  }
}
function browserPath() {
  if (process.env.DEMO_BROWSER_PATH) return process.env.DEMO_BROWSER_PATH;
  if (existsSync(chromium.executablePath())) return chromium.executablePath();
  const cache = join(homedir(), ".cache", "ms-playwright");
  if (existsSync(cache)) {
    for (const directory of readdirSync(cache)
      .filter((name) => /^chromium-\d+$/.test(name))
      .sort()
      .reverse()) {
      const path = join(cache, directory, "chrome-linux64", "chrome");
      if (existsSync(path)) return path;
    }
  }
  throw new Error("Chromium not found. Set DEMO_BROWSER_PATH to an installed Chromium executable.");
}
async function sendCount() {
  return page.evaluate(
    () => window.zethosDemoRequests.filter((method) => method === "eth_sendTransaction").length,
  );
}
async function command(text: string) {
  await page.locator("textarea").fill(text);
  await page.getByRole("button", { name: "Send to the agent", exact: true }).click();
}

try {
  for (const url of [webUrl, engineUrl]) {
    assert.ok(
      ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname),
      "Demo checks require local servers",
    );
  }
  const response = await fetch(`${engineUrl}/status`, { signal: AbortSignal.timeout(10000) });
  assert.ok(response.ok, "Engine status unavailable");
  const status = (await response.json()) as {
    mode: string;
    chainId: number;
    operator?: string | null;
  };
  assert.equal(status.mode, "live", "This check requires the configured live testnet demo");
  assert.equal(status.chainId, 133, "This check requires chain 133");
  const address = process.env.DEMO_TAKER_ADDRESS ?? status.operator;
  assert.ok(
    address && /^0x[\da-fA-F]{40}$/.test(address),
    "Set DEMO_TAKER_ADDRESS to a public funded testnet address",
  );
  browser = await chromium.launch({
    executablePath: browserPath(),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      let body: unknown;
      try {
        body = request.postDataJSON();
      } catch {
        /* Non-JSON asset request. */
      }
      const calls: unknown[] = Array.isArray(body) ? body : [body];
      if (
        calls.some(
          (call) =>
            typeof call === "object" &&
            call !== null &&
            "method" in call &&
            typeof call.method === "string" &&
            /^(eth_send|wallet_send|eth_sign|personal_sign)/.test(call.method),
        )
      ) {
        failures.push("Broadcast RPC blocked");
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  await context.addInitScript(
    ({ address, chainId }) => {
      window.zethosDemoRequests = [];
      let connected = sessionStorage.getItem("zethos.demo.connected") === "true";
      const provider = {
        isMetaMask: true,
        on() {},
        removeListener() {},
        async request({ method }: { method: string }) {
          window.zethosDemoRequests.push(method);
          if (method === "eth_accounts") return connected ? [address] : [];
          if (method === "eth_requestAccounts") {
            connected = true;
            sessionStorage.setItem("zethos.demo.connected", "true");
            return [address];
          }
          if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
          if (method === "net_version") return String(chainId);
          if (method === "wallet_requestPermissions" || method === "wallet_getPermissions")
            return [{ parentCapability: "eth_accounts" }];
          if (method === "eth_sendTransaction") {
            await new Promise((resolve) => setTimeout(resolve, 700));
            throw Object.assign(new Error("User rejected the request"), { code: 4001 });
          }
          throw Object.assign(new Error(`Stand-in refuses ${method}`), { code: 4200 });
        },
      };
      Object.defineProperty(window, "ethereum", { value: provider, configurable: false });
      const info = {
        uuid: "71074e8d-12c6-4753-86fe-17c3f6543210",
        name: "Demo stand-in",
        icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
        rdns: "demo.standin",
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent("eip6963:announceProvider", { detail: { info, provider } }),
        );
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { address, chainId: status.chainId },
  );
  page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on("pageerror", (error) => {
    failures.push(`Browser error: ${error.message}`);
  });

  await step("A1: connect stand-in wallet on Desk", async () => {
    await page.goto(`${webUrl}/desk`);
    await page
      .getByRole("region", { name: "Test the desk" })
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await page.getByRole("button", { name: /Demo stand-in/ }).click();
    await page
      .getByRole("region", { name: "Test the desk" })
      .getByRole("button", { name: "Get signed quote", exact: true })
      .waitFor();
  });
  const desk = () => page.getByRole("region", { name: "Test the desk" });
  await step("A2: real route-cap refusal", async () => {
    await desk().getByRole("button", { name: "Over the route cap", exact: true }).click();
    await desk()
      .getByRole("alert")
      .filter({ hasText: "Amount is above this route's limit" })
      .waitFor();
  });
  await step("A3: real minimum refusal", async () => {
    await desk().getByRole("button", { name: "Under the minimum", exact: true }).click();
    await desk()
      .getByRole("alert")
      .filter({ hasText: /Minimum swap|too small/ })
      .waitFor();
  });
  await step("A4: normal signed quote and local verification", async () => {
    await desk().getByRole("button", { name: "Normal trade", exact: true }).click();
    await desk().getByText("Verified against the on-chain vault signer", { exact: true }).waitFor();
    for (const heading of [
      "1. Where the price came from",
      "2. How the spread was built",
      "3. What was checked",
    ])
      await desk().getByRole("heading", { name: heading, exact: true }).waitFor();
  });
  await step("A5: settlement reaches a send and is cancelled", async () => {
    const before = await sendCount();
    await desk().getByRole("button", { name: "Settle from wallet", exact: true }).click();
    await desk()
      .getByText(
        "Transaction cancelled in your wallet. No further transaction will be requested.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await sendCount(), before + 1);
  });

  await step("B1: draft a 500 USDT HSK mission", async () => {
    await page.goto(`${webUrl}/agent`);
    await page.waitForFunction(() => {
      const dt = Array.from(document.querySelectorAll("dt")).find(
        (element) => element.textContent === "Fused mid",
      );
      return dt?.nextElementSibling?.textContent && dt.nextElementSibling.textContent !== "—";
    });
    await command("Buy 500 USDT of HSK");
    await page.getByRole("button", { name: "Authorize", exact: true }).last().waitFor();
    assert.ok(
      !/paper/i.test((await page.locator(".world-window").textContent()) ?? ""),
      "Live mission must not be labelled paper",
    );
  });
  await step("B2: authorize, verify, and decline the wallet send", async () => {
    const before = await sendCount();
    await page.getByRole("button", { name: "Authorize", exact: true }).last().click();
    await page
      .getByText(/Approve token spending in your wallet|Confirm the vault fill in your wallet/)
      .first()
      .waitFor();
    await page
      .getByText("You cancelled in your wallet, so nothing was filled.", { exact: true })
      .first()
      .waitFor();
    assert.equal(await sendCount(), before + 1);
    await page
      .getByRole("list", { name: "Mission progress" })
      .locator('li[data-state="done"]')
      .filter({ hasText: "Signature and terms match" })
      .waitFor();
  });
  await step("B3: read My position without inventing a new fill", async () => {
    await command("My position");
    await page.getByRole("heading", { name: "Your position", exact: true }).waitFor();
    assert.ok(!((await page.locator(".world-window").textContent()) ?? "").includes("Paper only"));
  });
  await step("B4: max 1 basis point (0.01%) refuses before settlement", async () => {
    await command("Buy 500 USDT of HSK, max 1 bps");
    await page.getByRole("button", { name: "Authorize", exact: true }).last().click();
    const before = await sendCount();
    await page
      .getByRole("alert")
      .filter({ hasText: /above your 1 bps limit/ })
      .waitFor({ timeout: 80000 });
    assert.equal(await sendCount(), before, "Cost refusal must not prompt the wallet");
  });

  await step("C1: launch and stop a paper attacker fill with no wallet request", async () => {
    await page.goto(`${webUrl}/arena`);
    const panel = page.getByRole("region", { name: "Launch attack", exact: true });
    await panel.getByRole("button", { name: "Launch attack", exact: true }).waitFor();
    const before = await page.evaluate(() => window.zethosDemoRequests.length);
    const filled = page.waitForResponse(
      (response) =>
        response.url() === `${engineUrl}/paper/fill` &&
        response.request().method() === "POST" &&
        response.ok(),
    );
    await panel.getByRole("button", { name: "Launch attack", exact: true }).click();
    try {
      const fill = (await (await filled).json()) as {
        id: string;
        paper: boolean;
        txHash: string | null;
        flow: string;
      };
      assert.equal(fill.paper, true);
      assert.ok(!fill.txHash);
      assert.equal(fill.flow, "attacker");
      await page.waitForFunction((id) => Boolean(document.getElementById(id)), fill.id);
      assert.equal(await page.evaluate(() => window.zethosDemoRequests.length), before);
    } finally {
      const stop = panel.getByRole("button", { name: "Stop", exact: true });
      if (await stop.count()) await stop.click();
    }
    await panel.getByText(/Finished/).waitFor();
  });
} catch (error) {
  failures.push("Setup");
  console.error(`FAIL Setup: ${error instanceof Error ? error.message : "Unknown failure"}`);
} finally {
  await browser?.close();
}
console.log(
  `${passed} steps passed; ${failures.length} failures. Every stand-in send was declined.`,
);
process.exitCode = failures.length ? 1 : 0;
