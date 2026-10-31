// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ZethosVault} from "../src/ZethosVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

/// @notice Moves inventory from the owner into the vault: one exact approval and deposit per token.
/// @dev Amounts are raw token units, so this script never assumes a token's decimals. A zero amount
/// skips that token. Everything is checked before the first transaction, so a shortfall can't leave
/// the vault half funded. The key stays in the keystore passed through `--account`.
contract Fund is Script {
    struct Config {
        ZethosVault vault;
        address owner;
        address usdt;
        address whsk;
        address weth;
        uint256 fundUsdt;
        uint256 fundWhsk;
        uint256 fundWeth;
    }

    /// @notice The configured owner isn't the vault's owner, and `deposit` is owner-only.
    error NotVaultOwner(address vaultOwner);
    /// @notice The owner holds less of `token` than the configured deposit.
    error InsufficientBalance(address token, uint256 balance, uint256 amount);

    function run() external {
        fund(
            Config({
                vault: ZethosVault(vm.envAddress("VAULT_ADDRESS")),
                owner: vm.envAddress("OPERATOR_ADDRESS"),
                usdt: vm.envAddress("USDT_ADDRESS"),
                whsk: vm.envAddress("WHSK_ADDRESS"),
                weth: vm.envAddress("WETH_ADDRESS"),
                fundUsdt: vm.envUint("FUND_USDT"),
                fundWhsk: vm.envUint("FUND_WHSK"),
                fundWeth: vm.envUint("FUND_WETH")
            })
        );
    }

    function fund(Config memory config) public {
        address vaultOwner = config.vault.owner();
        if (vaultOwner != config.owner) revert NotVaultOwner(vaultOwner);
        _requireBalance(config.usdt, config.owner, config.fundUsdt);
        _requireBalance(config.whsk, config.owner, config.fundWhsk);
        _requireBalance(config.weth, config.owner, config.fundWeth);

        vm.startBroadcast(config.owner);
        _deposit(config.vault, config.usdt, config.fundUsdt);
        _deposit(config.vault, config.whsk, config.fundWhsk);
        _deposit(config.vault, config.weth, config.fundWeth);
        vm.stopBroadcast();

        _logBalance(config.vault, config.usdt);
        _logBalance(config.vault, config.whsk);
        _logBalance(config.vault, config.weth);
    }

    function _requireBalance(address token, address owner, uint256 amount) private view {
        if (amount == 0) return;
        uint256 balance = IERC20(token).balanceOf(owner);
        if (balance < amount) revert InsufficientBalance(token, balance, amount);
    }

    function _deposit(ZethosVault vault, address token, uint256 amount) private {
        if (amount == 0) return;
        IERC20(token).approve(address(vault), amount);
        vault.deposit(token, amount);
    }

    /// @dev Logs the address, not `symbol()`: that's optional in ERC-20, and a log line shouldn't be
    /// able to abort a funding run.
    function _logBalance(ZethosVault vault, address token) private view {
        uint256 balance = IERC20(token).balanceOf(address(vault));
        console2.log("Vault balance (raw units) of", token, balance);
    }
}
