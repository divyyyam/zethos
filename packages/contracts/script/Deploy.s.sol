// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ZethosVault} from "../src/ZethosVault.sol";
import {IZethosVault} from "../src/interfaces/IZethosVault.sol";
import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/// @notice Deploys the vault and configures its four routes.
/// @dev Only public addresses come from the environment. The key stays in the encrypted keystore
/// passed through `--account`, which must be the owner, because route setup is owner-only.
/// See `.env.example` for every variable.
contract Deploy is Script {
    struct Config {
        address owner;
        address quoteSigner;
        address executor;
        uint64 maxTtl;
        address usdt;
        address whsk;
        address weth;
        address whskPool;
        address wethPool;
        uint16 poolToleranceBps;
        uint256 maxUsdtToWhsk;
        uint256 maxWhskToUsdt;
        uint256 maxUsdtToWeth;
        uint256 maxWethToUsdt;
    }

    function run() external returns (ZethosVault vault) {
        Config memory config = _load();

        vm.startBroadcast(config.owner);
        vault = new ZethosVault(config.owner, config.quoteSigner, config.executor, config.maxTtl);
        _setRoute(vault, config.usdt, config.whsk, config.maxUsdtToWhsk, config.whskPool, config);
        _setRoute(vault, config.whsk, config.usdt, config.maxWhskToUsdt, config.whskPool, config);
        _setRoute(vault, config.usdt, config.weth, config.maxUsdtToWeth, config.wethPool, config);
        _setRoute(vault, config.weth, config.usdt, config.maxWethToUsdt, config.wethPool, config);
        vm.stopBroadcast();

        console2.log("ZethosVault deployed at", address(vault));
    }

    function _load() private view returns (Config memory) {
        return Config({
            owner: vm.envAddress("OPERATOR_ADDRESS"),
            quoteSigner: vm.envAddress("QUOTE_SIGNER_ADDRESS"),
            executor: vm.envAddress("EXECUTOR_ADDRESS"),
            maxTtl: uint64(vm.envOr("MAX_TTL_SECONDS", uint256(120))),
            usdt: vm.envAddress("USDT_ADDRESS"),
            whsk: vm.envAddress("WHSK_ADDRESS"),
            weth: vm.envAddress("WETH_ADDRESS"),
            // Absent pools mean no on-chain venue to compare against, which is today's reality.
            whskPool: vm.envOr("WHSK_USDT_POOL_ADDRESS", address(0)),
            wethPool: vm.envOr("WETH_USDT_POOL_ADDRESS", address(0)),
            poolToleranceBps: uint16(vm.envOr("POOL_TOLERANCE_BPS", uint256(100))),
            // Raw token units: this script never assumes a token's decimals.
            maxUsdtToWhsk: vm.envUint("MAX_IN_USDT_TO_WHSK"),
            maxWhskToUsdt: vm.envUint("MAX_IN_WHSK_TO_USDT"),
            maxUsdtToWeth: vm.envUint("MAX_IN_USDT_TO_WETH"),
            maxWethToUsdt: vm.envUint("MAX_IN_WETH_TO_USDT")
        });
    }

    function _setRoute(
        ZethosVault vault,
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        address pool,
        Config memory config
    ) private {
        vault.setRoute(
            tokenIn,
            tokenOut,
            IZethosVault.Route({
                pool: pool,
                poolToleranceBps: config.poolToleranceBps,
                enabled: true,
                maxAmountIn: maxAmountIn
            })
        );
    }
}
