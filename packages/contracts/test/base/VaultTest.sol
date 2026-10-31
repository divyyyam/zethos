// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ZethosVault} from "../../src/ZethosVault.sol";
import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {Test} from "forge-std/Test.sol";

/// @notice A funded vault with both USDT/WHSK routes open, and helpers for signed quotes.
abstract contract VaultTest is Test {
    uint256 internal constant SIGNER_KEY = 0xA11CE;
    uint256 internal constant OTHER_KEY = 0xB0B;
    uint256 internal constant START_TIME = 1_800_000_000;
    uint256 internal constant ONE_USDT = 1e6;
    uint256 internal constant ONE_WHSK = 1e18;
    uint256 internal constant USDT_CAP = 1000 * ONE_USDT;
    uint256 internal constant VAULT_USDT = 5000 * ONE_USDT;
    uint256 internal constant VAULT_WHSK = 50_000 * ONE_WHSK;
    uint256 internal constant TAKER_USDT = 5000 * ONE_USDT;
    uint64 internal constant TTL = 30;

    address internal owner = makeAddr("owner");
    address internal executor = makeAddr("executor");
    address internal taker = makeAddr("taker");
    address internal outsider = makeAddr("outsider");
    address internal signer;

    ZethosVault internal vault;
    MockERC20 internal usdt;
    MockERC20 internal whsk;

    function setUp() public virtual {
        vm.warp(START_TIME);
        signer = vm.addr(SIGNER_KEY);
        vault = new ZethosVault(owner, signer, executor, 120);
        usdt = new MockERC20(6);
        whsk = new MockERC20(18);

        _setRoute(address(usdt), address(whsk), USDT_CAP, address(0), 0);
        _setRoute(address(whsk), address(usdt), 10_000 * ONE_WHSK, address(0), 0);

        usdt.mint(address(vault), VAULT_USDT);
        whsk.mint(address(vault), VAULT_WHSK);
        usdt.mint(taker, TAKER_USDT);
        vm.prank(taker);
        usdt.approve(address(vault), type(uint256).max);
    }

    function _setRoute(
        address tokenIn,
        address tokenOut,
        uint256 maxAmountIn,
        address pool,
        uint16 poolToleranceBps
    ) internal {
        vm.prank(owner);
        vault.setRoute(tokenIn, tokenOut, _route(maxAmountIn, pool, poolToleranceBps));
    }

    function _route(uint256 maxAmountIn, address pool, uint16 poolToleranceBps)
        internal
        pure
        returns (IZethosVault.Route memory)
    {
        return IZethosVault.Route({
            pool: pool, poolToleranceBps: poolToleranceBps, enabled: true, maxAmountIn: maxAmountIn
        });
    }

    /// @dev 100 USDT for 1,000 WHSK, issued now and valid for 30 seconds.
    function _quote(uint256 nonce) internal view returns (IZethosVault.Quote memory) {
        return IZethosVault.Quote({
            taker: taker,
            tokenIn: address(usdt),
            tokenOut: address(whsk),
            amountIn: 100 * ONE_USDT,
            amountOut: 1000 * ONE_WHSK,
            nonce: nonce,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp) + TTL
        });
    }

    function _sign(uint256 key, IZethosVault.Quote memory quote)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, vault.quoteDigest(quote));
        return abi.encodePacked(r, s, v);
    }

    function _fill(IZethosVault.Quote memory quote) internal {
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.prank(quote.taker);
        vault.fill(quote, signature);
    }

    function _expectFillRevert(IZethosVault.Quote memory quote, bytes4 selector) internal {
        _expectFillRevert(quote, abi.encodeWithSelector(selector));
    }

    /// @dev For errors with arguments: pins the exact revert data, not just the error's name.
    function _expectFillRevert(IZethosVault.Quote memory quote, bytes memory revertData) internal {
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.prank(quote.taker);
        vm.expectRevert(revertData);
        vault.fill(quote, signature);
    }
}
