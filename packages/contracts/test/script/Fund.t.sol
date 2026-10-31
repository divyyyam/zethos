// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fund} from "../../script/Fund.s.sol";
import {ZethosVault} from "../../src/ZethosVault.sol";
import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {ZethosTestToken} from "../../src/testnet/ZethosTestToken.sol";
import {Test} from "forge-std/Test.sol";

/// @dev Calls `fund` directly rather than `run`: token addresses are shared environment variables,
/// and tests run in parallel. `Deploy.t.sol` covers the environment wiring.
contract FundTest is Test {
    uint256 private constant SIGNER_KEY = 0xA11CE;
    uint256 private constant FUND_USDT = 5000e6;
    uint256 private constant FUND_WHSK = 50_000e18;
    uint256 private constant FUND_WETH = 2e18;

    address private owner = makeAddr("owner");
    address private executor = makeAddr("executor");
    address private taker = makeAddr("taker");

    Fund private script = new Fund();
    ZethosVault private vault;
    ZethosTestToken private usdt;
    ZethosTestToken private whsk;
    ZethosTestToken private weth;

    function setUp() public {
        vault = new ZethosVault(owner, vm.addr(SIGNER_KEY), executor, 120);
        usdt = new ZethosTestToken("Zethos Test USDT", "tUSDT", 6, owner);
        whsk = new ZethosTestToken("Zethos Test WHSK", "tWHSK", 18, owner);
        weth = new ZethosTestToken("Zethos Test WETH", "tWETH", 18, owner);

        vm.startPrank(owner);
        usdt.mint(owner, FUND_USDT);
        whsk.mint(owner, FUND_WHSK);
        weth.mint(owner, FUND_WETH);
        vm.stopPrank();
    }

    function _config() private view returns (Fund.Config memory) {
        return Fund.Config({
            vault: vault,
            owner: owner,
            usdt: address(usdt),
            whsk: address(whsk),
            weth: address(weth),
            fundUsdt: FUND_USDT,
            fundWhsk: FUND_WHSK,
            fundWeth: FUND_WETH
        });
    }

    function test_DepositsEveryToken() public {
        script.fund(_config());

        assertEq(usdt.balanceOf(address(vault)), FUND_USDT);
        assertEq(whsk.balanceOf(address(vault)), FUND_WHSK);
        assertEq(weth.balanceOf(address(vault)), FUND_WETH);
        assertEq(usdt.balanceOf(owner), 0);
    }

    function test_LeavesNoAllowanceBehind() public {
        script.fund(_config());

        assertEq(usdt.allowance(owner, address(vault)), 0);
        assertEq(whsk.allowance(owner, address(vault)), 0);
        assertEq(weth.allowance(owner, address(vault)), 0);
    }

    function test_ZeroAmountSkipsThatToken() public {
        Fund.Config memory config = _config();
        config.fundWhsk = 0;

        script.fund(config);

        assertEq(whsk.balanceOf(address(vault)), 0);
        assertEq(whsk.balanceOf(owner), FUND_WHSK);
        assertEq(usdt.balanceOf(address(vault)), FUND_USDT);
    }

    function test_RefusesAnOwnerThatDoesNotOwnTheVault() public {
        Fund.Config memory config = _config();
        config.owner = executor;

        vm.expectRevert(abi.encodeWithSelector(Fund.NotVaultOwner.selector, owner));
        script.fund(config);
    }

    function test_ShortfallStopsBeforeAnythingMoves() public {
        Fund.Config memory config = _config();
        config.fundWeth = FUND_WETH + 1;

        vm.expectRevert(
            abi.encodeWithSelector(
                Fund.InsufficientBalance.selector, address(weth), FUND_WETH, FUND_WETH + 1
            )
        );
        script.fund(config);

        assertEq(usdt.balanceOf(address(vault)), 0);
    }

    /// @dev The whole testnet path: a test token, funded by this script, settles a signed quote.
    function test_FundedVaultSettlesASignedQuote() public {
        script.fund(_config());
        vm.startPrank(owner);
        vault.setRoute(
            address(usdt),
            address(weth),
            IZethosVault.Route({
                pool: address(0), poolToleranceBps: 0, enabled: true, maxAmountIn: 1000e6
            })
        );
        usdt.mint(taker, 100e6);
        vm.stopPrank();

        IZethosVault.Quote memory quote = IZethosVault.Quote({
            taker: taker,
            tokenIn: address(usdt),
            tokenOut: address(weth),
            amountIn: 100e6,
            amountOut: 0.03e18,
            nonce: 1,
            issuedAt: uint64(block.timestamp),
            expiry: uint64(block.timestamp) + 30
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, vault.quoteDigest(quote));
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.startPrank(taker);
        usdt.approve(address(vault), quote.amountIn);
        vault.fill(quote, signature);
        vm.stopPrank();

        assertEq(usdt.balanceOf(taker), 0);
        assertEq(weth.balanceOf(taker), quote.amountOut);
        assertEq(usdt.balanceOf(address(vault)), FUND_USDT + quote.amountIn);
        assertEq(weth.balanceOf(address(vault)), FUND_WETH - quote.amountOut);
    }
}
