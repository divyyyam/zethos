// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {ZethosVault} from "../../src/ZethosVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Drives the vault with valid fills, replays and outsiders, and keeps its own ledger.
contract VaultHandler is Test {
    uint256 private constant SIGNER_KEY = 0xA11CE;

    ZethosVault public immutable vault;
    MockERC20 public immutable usdt;
    MockERC20 public immutable whsk;
    address public immutable taker;

    uint256 public totalIn;
    uint256 public totalOut;
    uint256 public fills;
    uint256 private _nextNonce = 1;
    IZethosVault.Quote private _lastQuote;
    bytes private _lastSignature;

    constructor(ZethosVault vault_, MockERC20 usdt_, MockERC20 whsk_, address taker_) {
        vault = vault_;
        usdt = usdt_;
        whsk = whsk_;
        taker = taker_;
    }

    function fill(uint256 amountIn, uint256 amountOut) external {
        amountIn = bound(amountIn, 1, 1_000e6);
        uint256 balance = whsk.balanceOf(address(vault));
        if (balance == 0 || usdt.balanceOf(taker) < amountIn) return;
        amountOut = bound(amountOut, 1, balance);

        IZethosVault.Quote memory quote = IZethosVault.Quote({
            taker: taker,
            tokenIn: address(usdt),
            tokenOut: address(whsk),
            amountIn: amountIn,
            amountOut: amountOut,
            nonce: _nextNonce++,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp) + 30
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, vault.quoteDigest(quote));
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(taker);
        vault.fill(quote, signature);

        totalIn += amountIn;
        totalOut += amountOut;
        fills += 1;
        _lastQuote = quote;
        _lastSignature = signature;
    }

    /// @dev Must never succeed. A replay would break the ledger the invariants compare against.
    function replay() external {
        if (fills == 0) return;
        vm.prank(taker);
        try vault.fill(_lastQuote, _lastSignature) {
            revert("replay succeeded");
        } catch {}
    }

    /// @dev Must never succeed either.
    function outsiderWithdraw(address outsider, uint256 amount) external {
        if (outsider == vault.owner()) return;
        vm.prank(outsider);
        try vault.withdraw(address(whsk), outsider, amount) {
            revert("outsider withdrew");
        } catch {}
    }
}

contract SolvencyInvariantTest is Test {
    uint256 private constant VAULT_USDT = 5_000e6;
    uint256 private constant VAULT_WHSK = 50_000e18;
    uint256 private constant TAKER_USDT = 1_000_000e6;

    ZethosVault private vault;
    MockERC20 private usdt;
    MockERC20 private whsk;
    VaultHandler private handler;
    address private taker = makeAddr("taker");

    function setUp() public {
        address owner = makeAddr("owner");
        vault = new ZethosVault(owner, vm.addr(0xA11CE), makeAddr("executor"), 120);
        usdt = new MockERC20(6);
        whsk = new MockERC20(18);
        vm.prank(owner);
        vault.setRoute(
            address(usdt),
            address(whsk),
            IZethosVault.Route({
                pool: address(0),
                poolToleranceBps: 0,
                enabled: true,
                maxAmountIn: 1_000e6
            })
        );
        usdt.mint(address(vault), VAULT_USDT);
        whsk.mint(address(vault), VAULT_WHSK);
        usdt.mint(taker, TAKER_USDT);
        vm.prank(taker);
        usdt.approve(address(vault), type(uint256).max);

        handler = new VaultHandler(vault, usdt, whsk, taker);
        targetContract(address(handler));
    }

    function invariant_VaultBalancesMatchTheLedger() public view {
        assertEq(usdt.balanceOf(address(vault)), VAULT_USDT + handler.totalIn());
        assertEq(whsk.balanceOf(address(vault)), VAULT_WHSK - handler.totalOut());
    }

    function invariant_NoTokensAppearOrDisappear() public view {
        assertEq(usdt.balanceOf(address(vault)) + usdt.balanceOf(taker), VAULT_USDT + TAKER_USDT);
        assertEq(whsk.balanceOf(address(vault)) + whsk.balanceOf(taker), VAULT_WHSK);
    }
}
