// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployTestTokens} from "../../script/DeployTestTokens.s.sol";
import {ZethosTestToken} from "../../src/testnet/ZethosTestToken.sol";

contract DeployTestTokensTest is Test {
    uint256 private constant MINT_USDT = 100_000e6;
    uint256 private constant MINT_WETH = 50e18;

    address private owner = makeAddr("owner");
    DeployTestTokens private script = new DeployTestTokens();

    function setUp() public {
        vm.chainId(133);
    }

    function _config() private view returns (DeployTestTokens.Config memory) {
        return DeployTestTokens.Config({owner: owner, mintUsdt: MINT_USDT, mintWeth: MINT_WETH});
    }

    function test_DeploysLabelledTokensAndMintsToTheOwner() public {
        (ZethosTestToken usdt, ZethosTestToken weth) = script.deploy(_config());

        assertEq(usdt.name(), "Zethos Test USDT");
        assertEq(usdt.symbol(), "tUSDT");
        assertEq(uint256(usdt.decimals()), 6);
        assertEq(usdt.owner(), owner);
        assertEq(usdt.balanceOf(owner), MINT_USDT);

        assertEq(weth.name(), "Zethos Test WETH");
        assertEq(weth.symbol(), "tWETH");
        assertEq(uint256(weth.decimals()), 18);
        assertEq(weth.owner(), owner);
        assertEq(weth.balanceOf(owner), MINT_WETH);
    }

    function test_RefusesMainnet() public {
        vm.chainId(177);
        DeployTestTokens.Config memory config = _config();
        vm.expectRevert(abi.encodeWithSelector(DeployTestTokens.WrongChain.selector, 177));
        script.deploy(config);
    }

    function test_RefusesAnyOtherChain() public {
        vm.chainId(1);
        DeployTestTokens.Config memory config = _config();
        vm.expectRevert(abi.encodeWithSelector(DeployTestTokens.WrongChain.selector, 1));
        script.deploy(config);
    }

    function test_RunReadsTheEnvironment() public {
        // The same value Deploy.t.sol sets: tests run in parallel and share the environment.
        vm.setEnv("OPERATOR_ADDRESS", vm.toString(owner));
        vm.setEnv("MINT_TUSDT", vm.toString(MINT_USDT));
        vm.setEnv("MINT_TWETH", vm.toString(MINT_WETH));

        (ZethosTestToken usdt, ZethosTestToken weth) = script.run();

        assertEq(usdt.balanceOf(owner), MINT_USDT);
        assertEq(weth.balanceOf(owner), MINT_WETH);
    }
}
