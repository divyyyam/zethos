// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {PoolPrice} from "../../src/libraries/PoolPrice.sol";
import {MockPool} from "../mocks/MockPool.sol";
import {Test} from "forge-std/Test.sol";

contract PoolPriceTest is Test {
    uint160 private constant PRICE_ONE = uint160(2 ** 96);
    uint160 private constant PRICE_FOUR = uint160(2 * 2 ** 96);

    address private tokenA = address(0xA);
    address private tokenB = address(0xB);

    function spotOutput(address pool, address tokenIn, uint256 amountIn)
        external
        view
        returns (uint256)
    {
        return PoolPrice.spotOutput(pool, tokenIn, amountIn);
    }

    function requireTokens(address pool, address a, address b) external view {
        PoolPrice.requireTokens(pool, a, b);
    }

    function test_OneToOne() public {
        MockPool pool = new MockPool(tokenA, tokenB, PRICE_ONE);
        assertEq(this.spotOutput(address(pool), tokenA, 1000), 1000);
        assertEq(this.spotOutput(address(pool), tokenB, 1000), 1000);
    }

    function test_AppliesPriceByDirection() public {
        MockPool pool = new MockPool(tokenA, tokenB, PRICE_FOUR);
        assertEq(this.spotOutput(address(pool), pool.token0(), 1000), 4000);
        assertEq(this.spotOutput(address(pool), pool.token1(), 1000), 250);
    }

    function test_HandlesLargeAmountsWithoutOverflow() public {
        MockPool pool = new MockPool(tokenA, tokenB, PRICE_FOUR);
        uint256 amount = 2 ** 128;
        assertEq(this.spotOutput(address(pool), pool.token0(), amount), amount * 4);
    }

    function test_RevertsForUninitializedPool() public {
        MockPool pool = new MockPool(tokenA, tokenB, 0);
        vm.expectRevert(IZethosVault.PoolUnavailable.selector);
        this.spotOutput(address(pool), tokenA, 1);
    }

    function test_RequireTokensAcceptsEitherOrder() public {
        MockPool pool = new MockPool(tokenA, tokenB, PRICE_ONE);
        this.requireTokens(address(pool), tokenA, tokenB);
        this.requireTokens(address(pool), tokenB, tokenA);
    }

    function test_RequireTokensRejectsOthers() public {
        MockPool pool = new MockPool(tokenA, tokenB, PRICE_ONE);
        vm.expectRevert(IZethosVault.PoolTokensMismatch.selector);
        this.requireTokens(address(pool), tokenA, address(0xC));
    }

    function testFuzz_RoundTripNeverGains(uint256 amount, uint160 sqrtPrice) public {
        amount = bound(amount, 1, 2 ** 96);
        uint160 price = uint160(bound(sqrtPrice, 2 ** 80, 2 ** 112));
        MockPool pool = new MockPool(tokenA, tokenB, price);
        uint256 out = this.spotOutput(address(pool), pool.token0(), amount);
        uint256 back = this.spotOutput(address(pool), pool.token1(), out);
        assertTrue(back <= amount);
    }
}
