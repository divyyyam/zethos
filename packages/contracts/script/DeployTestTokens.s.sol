// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ZethosTestToken} from "../src/testnet/ZethosTestToken.sol";

/// @notice Deploys test USDT and WETH for HSK testnet and mints starting inventory to the owner.
/// @dev Testnet only, enforced below. WHSK isn't deployed here: testnet already has one at the
/// predeploy address in `.env.example`. The key stays in the keystore passed through `--account`.
contract DeployTestTokens is Script {
    struct Config {
        address owner;
        uint256 mintUsdt;
        uint256 mintWeth;
    }

    /// @notice The script ran on a chain other than HSK testnet.
    error WrongChain(uint256 chainId);

    uint256 private constant HSK_TESTNET = 133;

    function run() external returns (ZethosTestToken usdt, ZethosTestToken weth) {
        return deploy(
            Config({
                owner: vm.envAddress("OPERATOR_ADDRESS"),
                // Raw token units, like every amount in these scripts.
                mintUsdt: vm.envUint("MINT_TUSDT"),
                mintWeth: vm.envUint("MINT_TWETH")
            })
        );
    }

    function deploy(Config memory config)
        public
        returns (ZethosTestToken usdt, ZethosTestToken weth)
    {
        if (block.chainid != HSK_TESTNET) revert WrongChain(block.chainid);

        vm.startBroadcast(config.owner);
        usdt = new ZethosTestToken("Zethos Test USDT", "tUSDT", 6, config.owner);
        weth = new ZethosTestToken("Zethos Test WETH", "tWETH", 18, config.owner);
        usdt.mint(config.owner, config.mintUsdt);
        weth.mint(config.owner, config.mintWeth);
        vm.stopBroadcast();

        console2.log("Test tokens deployed. Copy these into packages/contracts/.env:");
        console2.log(string.concat("USDT_ADDRESS=", vm.toString(address(usdt))));
        console2.log(string.concat("WETH_ADDRESS=", vm.toString(address(weth))));
    }
}
