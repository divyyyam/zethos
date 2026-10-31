// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @notice Burns 1% of every `transferFrom`, so the recipient gets less than was signed for.
contract FeeOnTransferToken is MockERC20(18) {
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100;
        super.transferFrom(from, to, amount);
        balanceOf[to] -= fee;
        totalSupply -= fee;
        return true;
    }
}
