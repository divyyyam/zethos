import type { NextConfig } from "next";

// @coinbase/cdp-sdk (pulled in by RainbowKit's Base Account connector) lazily imports its
// optional @x402/* peers. They are not installed, so stub them out for Turbopack.
const emptyModule = "./src/lib/empty-module.ts";
const optionalPeers = ["@x402/core", "@x402/evm", "@x402/extensions", "@x402/svm"];

const nextConfig: NextConfig = {
  transpilePackages: ["@zethos/sdk", "@zethos/shared"],
  turbopack: {
    resolveAlias: Object.fromEntries(
      optionalPeers.flatMap((pkg) => [
        [pkg, emptyModule],
        [`${pkg}/*`, emptyModule],
      ]),
    ),
  },
};
export default nextConfig;
