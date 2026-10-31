// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {VaultTest} from "../base/VaultTest.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract FillFuzzTest is VaultTest {
    function testFuzz_SettlesExactAmounts(uint256 amountIn, uint256 amountOut, uint256 nonce)
        public
    {
        amountIn = bound(amountIn, 1, USDT_CAP);
        amountOut = bound(amountOut, 1, VAULT_WHSK);

        IZethosVault.Quote memory quote = _quote(nonce);
        quote.amountIn = amountIn;
        quote.amountOut = amountOut;
        _fill(quote);

        assertEq(usdt.balanceOf(address(vault)), VAULT_USDT + amountIn);
        assertEq(whsk.balanceOf(address(vault)), VAULT_WHSK - amountOut);
        assertEq(usdt.balanceOf(taker), TAKER_USDT - amountIn);
        assertEq(whsk.balanceOf(taker), amountOut);
        assertTrue(vault.isNonceUsed(taker, nonce));
    }

    function testFuzz_ExpiryIsEnforced(uint32 lifetime, uint32 elapsed) public {
        uint64 ttl = uint64(bound(lifetime, 1, vault.maxTtl()));
        IZethosVault.Quote memory quote = _quote(1);
        quote.expiry = quote.issuedAt + ttl;
        bytes memory signature = _sign(SIGNER_KEY, quote);

        vm.warp(block.timestamp + elapsed);
        vm.prank(taker);
        if (elapsed > ttl) {
            vm.expectRevert(
                abi.encodeWithSelector(IZethosVault.QuoteExpired.selector, quote.expiry)
            );
        }
        vault.fill(quote, signature);
    }

    function testFuzz_AnyOtherKeyIsRejected(uint256 key) public {
        key = bound(key, 1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364140);
        vm.assume(key != SIGNER_KEY);

        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(key, quote);
        vm.prank(taker);
        vm.expectRevert(IZethosVault.InvalidSignature.selector);
        vault.fill(quote, signature);
    }

    /// @dev The floor scales with the tolerance, whatever the pool's price.
    function testFuzz_PoolFloorHolds(uint96 sqrtPrice, uint16 toleranceBps, uint256 amountOut)
        public
    {
        // Keeps the pool's spot output for 100 USDT within what mulDiv and the vault can hold.
        uint160 price = uint160(bound(sqrtPrice, 2 ** 88, 2 ** 94));
        uint16 tolerance = uint16(bound(toleranceBps, 0, 10_000));
        MockPool pool = new MockPool(address(usdt), address(whsk), price);
        _setRoute(address(usdt), address(whsk), USDT_CAP, address(pool), tolerance);

        amountOut = bound(amountOut, 1, VAULT_WHSK);
        IZethosVault.Quote memory quote = _quote(1);
        quote.amountOut = amountOut;
        bytes memory signature = _sign(SIGNER_KEY, quote);

        vm.prank(taker);
        try vault.fill(quote, signature) {
            assertEq(whsk.balanceOf(taker), amountOut);
        } catch (bytes memory reason) {
            assertEq(bytes4(reason), IZethosVault.WorseThanPool.selector);
            assertEq(whsk.balanceOf(taker), 0);
        }
    }
}
