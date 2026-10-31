// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {VaultTest} from "../base/VaultTest.sol";
import {ContractTaker} from "../mocks/ContractTaker.sol";
import {FeeOnTransferToken} from "../mocks/FeeOnTransferToken.sol";
import {ReentrantToken} from "../mocks/ReentrantToken.sol";

contract FillTest is VaultTest {
    function test_MovesBothLegs() public {
        _fill(_quote(1));

        assertEq(usdt.balanceOf(taker), TAKER_USDT - 100 * ONE_USDT);
        assertEq(whsk.balanceOf(taker), 1000 * ONE_WHSK);
        assertEq(usdt.balanceOf(address(vault)), VAULT_USDT + 100 * ONE_USDT);
        assertEq(whsk.balanceOf(address(vault)), VAULT_WHSK - 1000 * ONE_WHSK);
        assertTrue(vault.isNonceUsed(taker, 1));
    }

    function test_EmitsFill() public {
        IZethosVault.Quote memory quote = _quote(1);
        vm.expectEmit();
        emit IZethosVault.Fill(
            taker, address(usdt), address(whsk), quote.amountIn, quote.amountOut, 1, 0
        );
        _fill(quote);
    }

    function test_AcceptsLastValidSecond() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.warp(quote.expiry);
        vm.prank(taker);
        vault.fill(quote, signature);
    }

    function test_AcceptsIssuedAtWithinClockSkew() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.issuedAt = uint64(block.timestamp) + vault.MAX_CLOCK_SKEW();
        quote.expiry = quote.issuedAt + TTL;
        _fill(quote);
    }

    function test_RevertsForAnyoneButTheTaker() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.prank(outsider);
        vm.expectRevert(IZethosVault.NotTaker.selector);
        vault.fill(quote, signature);
    }

    function test_RevertsAfterExpiry() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.warp(uint256(quote.expiry) + 1);
        vm.prank(taker);
        vm.expectRevert(abi.encodeWithSelector(IZethosVault.QuoteExpired.selector, quote.expiry));
        vault.fill(quote, signature);
    }

    /// @dev A far-future `issuedAt` would otherwise stretch a quote past the lifetime limit.
    function test_RevertsForFutureIssuedAt() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.issuedAt = uint64(block.timestamp) + vault.MAX_CLOCK_SKEW() + 1;
        quote.expiry = quote.issuedAt + TTL;
        _expectFillRevert(
            quote, abi.encodeWithSelector(IZethosVault.QuoteNotYetValid.selector, quote.issuedAt)
        );
    }

    function test_RevertsForTtlAboveMax() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.expiry = quote.issuedAt + vault.maxTtl() + 1;
        _expectFillRevert(quote, IZethosVault.TtlTooLong.selector);
    }

    function test_RevertsForEmptyLifetime() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.expiry = quote.issuedAt;
        _expectFillRevert(quote, IZethosVault.TtlTooLong.selector);
    }

    function test_NonceIsSingleUse() public {
        IZethosVault.Quote memory quote = _quote(1);
        _fill(quote);
        _expectFillRevert(quote, IZethosVault.NonceUsed.selector);
    }

    function test_NoncesAreScopedToTheTaker() public {
        _fill(_quote(1));

        usdt.mint(outsider, 100 * ONE_USDT);
        vm.prank(outsider);
        usdt.approve(address(vault), type(uint256).max);
        IZethosVault.Quote memory quote = _quote(1);
        quote.taker = outsider;
        _fill(quote);

        assertEq(whsk.balanceOf(outsider), 1000 * ONE_WHSK);
    }

    function test_RevertsWhilePaused() public {
        vm.prank(executor);
        vault.pause();
        _expectFillRevert(_quote(1), bytes4(keccak256("EnforcedPause()")));
    }

    function test_RevertsForDisabledRoute() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.tokenOut = address(usdt);
        quote.tokenIn = address(whsk);
        vm.prank(owner);
        vault.setRoute(
            address(whsk),
            address(usdt),
            IZethosVault.Route({
                pool: address(0),
                poolToleranceBps: 0,
                enabled: false,
                maxAmountIn: type(uint256).max
            })
        );
        _expectFillRevert(quote, IZethosVault.RouteDisabled.selector);
    }

    function test_RevertsForZeroAmounts() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.amountOut = 0;
        _expectFillRevert(quote, IZethosVault.InvalidAmount.selector);

        quote = _quote(1);
        quote.amountIn = 0;
        _expectFillRevert(quote, IZethosVault.InvalidAmount.selector);
    }

    function test_RevertsAboveSizeCap() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.amountIn = USDT_CAP + 1;
        _expectFillRevert(
            quote, abi.encodeWithSelector(IZethosVault.SizeCapExceeded.selector, USDT_CAP)
        );
    }

    function test_RevertsAboveInventory() public {
        IZethosVault.Quote memory quote = _quote(1);
        quote.amountOut = VAULT_WHSK + 1;
        _expectFillRevert(
            quote, abi.encodeWithSelector(IZethosVault.InsufficientInventory.selector, VAULT_WHSK)
        );
    }

    function test_FailedPullLeavesEverythingUntouched() public {
        vm.prank(taker);
        usdt.approve(address(vault), 0);
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);

        vm.prank(taker);
        vm.expectRevert();
        vault.fill(quote, signature);

        assertFalse(vault.isNonceUsed(taker, 1));
        assertEq(whsk.balanceOf(taker), 0);
        assertEq(whsk.balanceOf(address(vault)), VAULT_WHSK);
    }

    function test_RevertsForFeeOnTransferInput() public {
        FeeOnTransferToken token = new FeeOnTransferToken();
        _setRoute(address(token), address(whsk), 1000 * ONE_WHSK, address(0), 0);
        token.mint(taker, 100 * ONE_WHSK);
        vm.prank(taker);
        token.approve(address(vault), type(uint256).max);

        IZethosVault.Quote memory quote = _quote(1);
        quote.tokenIn = address(token);
        quote.amountIn = 100 * ONE_WHSK;
        _expectFillRevert(quote, IZethosVault.UnsupportedToken.selector);
    }

    /// @dev The taker is a contract, so the re-entrant call passes the taker check and has a valid
    /// signature. Only the reentrancy guard can stop it.
    function test_GuardStopsReentrantTaker() public {
        ContractTaker attacker = new ContractTaker();
        ReentrantToken token = new ReentrantToken();
        _setRoute(address(token), address(whsk), 1000 * ONE_WHSK, address(0), 0);
        token.mint(address(attacker), 200 * ONE_WHSK);
        attacker.execute(
            address(token), abi.encodeCall(token.approve, (address(vault), type(uint256).max))
        );

        IZethosVault.Quote memory first = _quote(1);
        first.taker = address(attacker);
        first.tokenIn = address(token);
        first.amountIn = 100 * ONE_WHSK;
        IZethosVault.Quote memory second = _quote(2);
        second.taker = address(attacker);
        second.tokenIn = address(token);
        second.amountIn = 100 * ONE_WHSK;

        bytes memory reenter = abi.encodeCall(vault.fill, (second, _sign(SIGNER_KEY, second)));
        token.arm(address(attacker), abi.encodeCall(attacker.execute, (address(vault), reenter)));
        attacker.execute(
            address(vault), abi.encodeCall(vault.fill, (first, _sign(SIGNER_KEY, first)))
        );

        assertTrue(token.attempted());
        assertFalse(token.succeeded());
        assertFalse(vault.isNonceUsed(address(attacker), 2));
        assertEq(whsk.balanceOf(address(attacker)), 1000 * ONE_WHSK);
    }
}
