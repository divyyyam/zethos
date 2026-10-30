import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createZethos } from "@zethos/sdk";
import { hskMainnet, hskTestnet } from "@zethos/shared";
import { createPublicClient, http } from "viem";
import { loadConfig } from "./config.js";
import { createHttpHandler } from "./http.js";
import { createServer } from "./server.js";
import { TradingService } from "./service.js";
import { Ledger } from "./store.js";

async function main() {
  const args = process.argv.slice(2);
  const transport =
    args.length === 0 ? "stdio" : args.length === 2 && args[0] === "--transport" ? args[1] : null;
  if (transport !== "stdio" && transport !== "http")
    throw new Error("Usage: bun src/index.ts [--transport stdio|http]");
  const config = loadConfig(process.env);
  const ledger = new Ledger(
    config.statePath,
    `${config.engineUrl}|${config.chainId}|${config.taker.toLowerCase()}`,
  );
  const sdk = createZethos({
    engineUrl: config.engineUrl,
    chainId: config.chainId,
    client: "mcp",
    ...(config.rpcUrl
      ? {
          publicClient: createPublicClient({
            chain: config.chainId === 177 ? hskMainnet : hskTestnet,
            transport: http(config.rpcUrl),
          }),
        }
      : {}),
  });
  const service = new TradingService(sdk, config, ledger);
  if (transport === "stdio") {
    const server = createServer(service);
    const stop = async () => {
      await server.close();
      ledger.close();
    };
    process.once("SIGINT", () => {
      void stop();
    });
    process.once("SIGTERM", () => {
      void stop();
    });
    await server.connect(
      new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
    );
    // stdout belongs exclusively to the MCP transport.
  } else {
    const server = Bun.serve({
      hostname: config.host,
      port: config.port,
      maxRequestBodySize: 65536,
      fetch: createHttpHandler(service, config),
    });
    console.error(`Zethos MCP listening at ${server.url}mcp; public taker ${config.taker}`);
    const stop = async () => {
      await server.stop();
      ledger.close();
    };
    process.once("SIGINT", () => {
      void stop();
    });
    process.once("SIGTERM", () => {
      void stop();
    });
  }
}
main().catch(() => {
  // Configuration and network errors may contain credentialed URLs. Keep logs redacted.
  console.error(
    "Zethos MCP failed to start. Check public configuration, transport and state-path access in apps/mcp/README.md.",
  );
  process.exitCode = 1;
});
