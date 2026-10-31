import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const here = fileURLToPath(new URL(".", import.meta.url));
// If running inside a git worktree (.worktrees/<name>/apps/web), allow Turbopack to resolve
// dependencies junctioned from the main repository root.
const projectRoot = here.includes(".worktrees")
  ? resolve(here, "../../../..")
  : resolve(here, "../..");

// @coinbase/cdp-sdk (pulled in by RainbowKit's Base Account connector) lazily imports its
// optional @x402/* peers. They are not installed, so stub them out for Turbopack.
const emptyModule = "./src/lib/empty-module.ts";
const optionalPeers = ["@x402/core", "@x402/evm", "@x402/extensions", "@x402/svm"];

const nextConfig: NextConfig = {
  transpilePackages: ["@zethos/sdk", "@zethos/shared"],
  turbopack: {
    root: projectRoot,
    resolveAlias: Object.fromEntries(
      optionalPeers.flatMap((pkg) => [
        [pkg, emptyModule],
        [`${pkg}/*`, emptyModule],
      ]),
    ),
  },
};
export default nextConfig;
