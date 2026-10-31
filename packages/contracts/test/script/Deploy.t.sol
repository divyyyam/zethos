// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {ZethosVault} from "../../src/ZethosVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract DeployTest is Test {
    address private owner = makeAddr("owner");
    address private quoteSigner = makeAddr("quoteSigner");
    address private executor = makeAddr("executor");
    MockERC20 private usdt = new MockERC20(6);
    MockERC20 private whsk = new MockERC20(18);
    MockERC20 private weth = new MockERC20(18);

    function setUp() public {
        vm.setEnv("OPERATOR_ADDRESS", vm.toString(owner));
        vm.setEnv("QUOTE_SIGNER_ADDRESS", vm.toString(quoteSigner));
        vm.setEnv("EXECUTOR_ADDRESS", vm.toString(executor));
        vm.setEnv("USDT_ADDRESS", vm.toString(address(usdt)));
        vm.setEnv("WHSK_ADDRESS", vm.toString(address(whsk)));
        vm.setEnv("WETH_ADDRESS", vm.toString(address(weth)));
        vm.setEnv("MAX_IN_USDT_TO_WHSK", "1000");
        vm.setEnv("MAX_IN_WHSK_TO_USDT", "2000");
        vm.setEnv("MAX_IN_USDT_TO_WETH", "3000");
        vm.setEnv("MAX_IN_WETH_TO_USDT", "4000");
    }

    function test_DeploysAndConfiguresEveryRoute() public {
        ZethosVault vault = new Deploy().run();

        assertEq(vault.owner(), owner);
        assertEq(vault.quoteSigner(), quoteSigner);
        assertEq(vault.executor(), executor);
        assertEq(uint256(vault.maxTtl()), 120);
        _assertRoute(vault, address(usdt), address(whsk), 1000);
        _assertRoute(vault, address(whsk), address(usdt), 2000);
        _assertRoute(vault, address(usdt), address(weth), 3000);
        _assertRoute(vault, address(weth), address(usdt), 4000);
    }

    function _assertRoute(ZethosVault vault, address tokenIn, address tokenOut, uint256 cap)
        private
        view
    {
        IZethosVault.Route memory route = vault.routeOf(tokenIn, tokenOut);
        assertTrue(route.enabled);
        assertEq(route.maxAmountIn, cap);
        assertEq(route.pool, address(0));
    }
}
