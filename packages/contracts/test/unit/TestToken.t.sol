// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ZethosTestToken} from "../../src/testnet/ZethosTestToken.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Test} from "forge-std/Test.sol";

contract TestTokenTest is Test {
    address private owner = makeAddr("owner");
    address private outsider = makeAddr("outsider");
    ZethosTestToken private token = new ZethosTestToken("Zethos Test USDT", "tUSDT", 6, owner);

    function test_MetadataIsWhatTheDeployerChose() public view {
        assertEq(token.name(), "Zethos Test USDT");
        assertEq(token.symbol(), "tUSDT");
        assertEq(uint256(token.decimals()), 6);
        assertEq(token.owner(), owner);
        assertEq(token.totalSupply(), 0);
    }

    function test_OwnerMints() public {
        vm.prank(owner);
        token.mint(outsider, 1000);

        assertEq(token.balanceOf(outsider), 1000);
        assertEq(token.totalSupply(), 1000);
    }

    function test_OutsiderCannotMint() public {
        vm.prank(outsider);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider)
        );
        token.mint(outsider, 1000);
    }

    function test_ZeroOwnerIsRefused() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ZethosTestToken("Zethos Test USDT", "tUSDT", 6, address(0));
    }
}
