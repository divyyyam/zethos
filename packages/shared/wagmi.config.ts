import { defineConfig } from "@wagmi/cli";
import { foundry } from "@wagmi/cli/plugins";

export default defineConfig({
  out: "src/generated.ts",
  plugins: [
    foundry({
      project: "../contracts",
      artifacts: "out",
      include: [
        "ZethosVault.sol/ZethosVault.json",
        "IUniswapV3Pool.sol/*.json",
        "ISwapRouter.sol/*.json",
      ],
      forge: { build: false, rebuild: false },
    }),
  ],
});
