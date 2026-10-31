// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {ZethosVault} from "../../src/ZethosVault.sol";
import {VaultTest} from "../base/VaultTest.sol";
import {MockPool} from "../mocks/MockPool.sol";

contract ConstructorTest is VaultTest {
    function test_RevertsForSharedKeys() public {
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        new ZethosVault(owner, owner, executor, 120);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        new ZethosVault(owner, signer, owner, 120);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        new ZethosVault(owner, signer, signer, 120);
    }

    function test_RevertsForZeroKeys() public {
        vm.expectRevert(IZethosVault.ZeroAddress.selector);
        new ZethosVault(owner, address(0), executor, 120);
        vm.expectRevert(IZethosVault.ZeroAddress.selector);
        new ZethosVault(owner, signer, address(0), 120);
    }

    function test_RevertsForTtlOutOfRange() public {
        vm.expectRevert(IZethosVault.InvalidConfig.selector);
        new ZethosVault(owner, signer, executor, 0);
        vm.expectRevert(IZethosVault.InvalidConfig.selector);
        new ZethosVault(owner, signer, executor, 121);
    }

    function test_SetsRoles() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.quoteSigner(), signer);
        assertEq(vault.executor(), executor);
        assertEq(uint256(vault.maxTtl()), 120);
    }
}

contract AccessControlTest is VaultTest {
    function test_OnlyOwnerCanConfigure() public {
        address[3] memory unauthorized = [executor, signer, outsider];
        for (uint256 i = 0; i < unauthorized.length; i++) {
            address caller = unauthorized[i];
            _expectUnauthorized(caller, abi.encodeCall(vault.setQuoteSigner, (outsider)));
            _expectUnauthorized(caller, abi.encodeCall(vault.setExecutor, (outsider)));
            _expectUnauthorized(caller, abi.encodeCall(vault.setMaxTtl, (60)));
            _expectUnauthorized(
                caller,
                abi.encodeCall(
                    vault.setRoute, (address(usdt), address(whsk), _route(1, address(0), 0))
                )
            );
            _expectUnauthorized(caller, abi.encodeCall(vault.deposit, (address(usdt), 1)));
            _expectUnauthorized(caller, abi.encodeCall(vault.withdraw, (address(usdt), caller, 1)));
            _expectUnauthorized(caller, abi.encodeCall(vault.unpause, ()));
            _expectUnauthorized(caller, abi.encodeCall(vault.transferOwnership, (outsider)));
        }
    }

    function _expectUnauthorized(address caller, bytes memory data) private {
        vm.prank(caller);
        (bool ok, bytes memory result) = address(vault).call(data);
        assertFalse(ok);
        assertEq(
            result,
            abi.encodeWithSelector(
                bytes4(keccak256("OwnableUnauthorizedAccount(address)")), caller
            )
        );
    }
}

contract PauseTest is VaultTest {
    function test_ExecutorCanPauseButOnlyOwnerCanResume() public {
        vm.prank(executor);
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(owner);
        vault.unpause();
        assertFalse(vault.paused());
    }

    function test_OwnerCanPause() public {
        vm.prank(owner);
        vault.pause();
        assertTrue(vault.paused());
    }

    function test_OutsiderAndSignerCannotPause() public {
        vm.prank(outsider);
        vm.expectRevert(IZethosVault.NotOwnerOrExecutor.selector);
        vault.pause();

        vm.prank(signer);
        vm.expectRevert(IZethosVault.NotOwnerOrExecutor.selector);
        vault.pause();
    }
}

contract InventoryTest is VaultTest {
    function test_DepositPullsFromOwner() public {
        usdt.mint(owner, 10 * ONE_USDT);
        vm.prank(owner);
        usdt.approve(address(vault), 10 * ONE_USDT);

        vm.expectEmit();
        emit IZethosVault.Deposit(address(usdt), 10 * ONE_USDT);
        vm.prank(owner);
        vault.deposit(address(usdt), 10 * ONE_USDT);

        assertEq(usdt.balanceOf(address(vault)), VAULT_USDT + 10 * ONE_USDT);
    }

    function test_WithdrawWorksWhilePaused() public {
        vm.prank(executor);
        vault.pause();

        vm.expectEmit();
        emit IZethosVault.Withdraw(address(usdt), owner, VAULT_USDT);
        vm.prank(owner);
        vault.withdraw(address(usdt), owner, VAULT_USDT);

        assertEq(usdt.balanceOf(owner), VAULT_USDT);
        assertEq(usdt.balanceOf(address(vault)), 0);
    }

    function test_WithdrawRevertsForZeroRecipient() public {
        vm.prank(owner);
        vm.expectRevert(IZethosVault.ZeroAddress.selector);
        vault.withdraw(address(usdt), address(0), 1);
    }
}

contract RolesTest is VaultTest {
    function test_KeysCannotMerge() public {
        vm.startPrank(owner);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.setQuoteSigner(executor);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.setQuoteSigner(owner);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.setExecutor(signer);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.setExecutor(owner);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.transferOwnership(signer);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.transferOwnership(executor);
        vm.stopPrank();
    }

    function test_KeysCannotMergeWithThePendingOwner() public {
        address next = makeAddr("next");
        vm.startPrank(owner);
        vault.transferOwnership(next);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.setQuoteSigner(next);
        vm.expectRevert(IZethosVault.RolesMustDiffer.selector);
        vault.setExecutor(next);
        vm.stopPrank();
    }

    function test_RotatesKeys() public {
        address nextSigner = makeAddr("nextSigner");
        address nextExecutor = makeAddr("nextExecutor");
        vm.startPrank(owner);
        vault.setQuoteSigner(nextSigner);
        vault.setExecutor(nextExecutor);
        vm.stopPrank();
        assertEq(vault.quoteSigner(), nextSigner);
        assertEq(vault.executor(), nextExecutor);
    }

    function test_OwnershipTransferTakesTwoSteps() public {
        address next = makeAddr("next");
        vm.prank(owner);
        vault.transferOwnership(next);
        assertEq(vault.owner(), owner);

        vm.prank(next);
        vault.acceptOwnership();
        assertEq(vault.owner(), next);
    }

    function test_OwnershipCannotBeRenounced() public {
        vm.prank(owner);
        vm.expectRevert(IZethosVault.RenounceDisabled.selector);
        vault.renounceOwnership();
    }
}

contract ConfigTest is VaultTest {
    function test_MaxTtlStaysInRange() public {
        vm.startPrank(owner);
        vm.expectRevert(IZethosVault.InvalidConfig.selector);
        vault.setMaxTtl(0);
        vm.expectRevert(IZethosVault.InvalidConfig.selector);
        vault.setMaxTtl(121);
        vault.setMaxTtl(10);
        vm.stopPrank();
        assertEq(uint256(vault.maxTtl()), 10);
    }

    function test_TighterTtlAppliesToSignedQuotes() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.prank(owner);
        vault.setMaxTtl(10);
        vm.prank(taker);
        vm.expectRevert(IZethosVault.TtlTooLong.selector);
        vault.fill(quote, signature);
    }

    function test_RouteRoundTrips() public view {
        IZethosVault.Route memory route = vault.routeOf(address(usdt), address(whsk));
        assertTrue(route.enabled);
        assertEq(route.maxAmountIn, USDT_CAP);
        assertEq(route.pool, address(0));
    }

    function test_RouteDirectionsAreIndependent() public {
        _setRoute(address(usdt), address(whsk), 1, address(0), 0);
        assertEq(vault.routeOf(address(usdt), address(whsk)).maxAmountIn, 1);
        assertEq(vault.routeOf(address(whsk), address(usdt)).maxAmountIn, 10_000 * ONE_WHSK);
    }

    function test_RouteRevertsForSameToken() public {
        vm.prank(owner);
        vm.expectRevert(IZethosVault.InvalidConfig.selector);
        vault.setRoute(address(usdt), address(usdt), _route(1, address(0), 0));
    }

    function test_RouteRevertsForToleranceAboveOneHundredPercent() public {
        vm.prank(owner);
        vm.expectRevert(IZethosVault.InvalidConfig.selector);
        vault.setRoute(address(usdt), address(whsk), _route(1, address(0), 10_001));
    }

    function test_RouteRevertsForTokenWithoutCode() public {
        vm.startPrank(owner);
        vm.expectRevert(abi.encodeWithSelector(IZethosVault.NotAContract.selector, outsider));
        vault.setRoute(outsider, address(whsk), _route(1, address(0), 0));
        vm.expectRevert(abi.encodeWithSelector(IZethosVault.NotAContract.selector, outsider));
        vault.setRoute(address(usdt), outsider, _route(1, address(0), 0));
        vm.stopPrank();
    }

    function test_RouteRevertsForPoolOfOtherTokens() public {
        MockPool pool = new MockPool(address(usdt), address(this), 2 ** 96);
        vm.prank(owner);
        vm.expectRevert(IZethosVault.PoolTokensMismatch.selector);
        vault.setRoute(address(usdt), address(whsk), _route(1, address(pool), 0));
    }
}
