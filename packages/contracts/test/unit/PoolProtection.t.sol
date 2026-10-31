// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {VaultTest} from "../base/VaultTest.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract PoolProtectionTest is VaultTest {
    uint160 private constant PRICE_ONE = uint160(2 ** 96);
    uint160 private constant PRICE_FOUR = uint160(2 * 2 ** 96);

    function _protect(uint160 sqrtPrice, uint16 toleranceBps) private returns (MockPool pool) {
        pool = new MockPool(address(usdt), address(whsk), sqrtPrice);
        _setRoute(address(usdt), address(whsk), USDT_CAP, address(pool), toleranceBps);
    }

    function _quoteFor(uint256 amountOut) private view returns (IZethosVault.Quote memory quote) {
        quote = _quote(1);
        quote.amountOut = amountOut;
    }

    function _worseThanPool(uint256 minimumOut) private pure returns (bytes memory) {
        return abi.encodeWithSelector(IZethosVault.WorseThanPool.selector, minimumOut);
    }

    function test_RevertsBelowSpot() public {
        _protect(PRICE_ONE, 0);
        _expectFillRevert(_quoteFor(100 * ONE_USDT - 1), _worseThanPool(100 * ONE_USDT));
    }

    function test_AcceptsExactlySpotAndRecordsIt() public {
        _protect(PRICE_ONE, 0);
        IZethosVault.Quote memory quote = _quoteFor(100 * ONE_USDT);
        vm.expectEmit();
        emit IZethosVault.Fill(
            taker, address(usdt), address(whsk), quote.amountIn, quote.amountOut, 1, quote.amountOut
        );
        _fill(quote);
    }

    function test_ToleranceIsExact() public {
        _protect(PRICE_ONE, 100);
        _expectFillRevert(_quoteFor(99 * ONE_USDT - 1), _worseThanPool(99 * ONE_USDT));
        _fill(_quoteFor(99 * ONE_USDT));
    }

    function test_PricesBothDirections() public {
        MockPool pool = _protect(PRICE_FOUR, 0);
        // token1 per token0 is 4: token0 in earns four times, token1 in earns a quarter.
        uint256 fair = pool.token0() == address(usdt) ? 400 * ONE_USDT : 25 * ONE_USDT;
        _expectFillRevert(_quoteFor(fair - 1), _worseThanPool(fair));
        _fill(_quoteFor(fair));
    }

    function test_PriceMoveAfterSigningBlocksTheFill() public {
        MockPool pool = _protect(PRICE_ONE, 0);
        IZethosVault.Quote memory quote = _quoteFor(100 * ONE_USDT);
        bytes memory signature = _sign(SIGNER_KEY, quote);

        // Quadruples the pool's output for USDT, whichever side of the pool USDT is on.
        bool usdtIsToken0 = pool.token0() == address(usdt);
        pool.setSqrtPrice(usdtIsToken0 ? PRICE_ONE * 2 : PRICE_ONE / 2);

        vm.prank(taker);
        vm.expectRevert(_worseThanPool(400 * ONE_USDT));
        vault.fill(quote, signature);
    }

    function test_UninitializedPoolFailsClosed() public {
        _protect(0, 0);
        _expectFillRevert(_quote(1), IZethosVault.PoolUnavailable.selector);
    }
}
