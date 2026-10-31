// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MockERC20} from "./MockERC20.sol";

/// @notice Makes one armed call during `transferFrom`, and records whether it succeeded.
contract ReentrantToken is MockERC20(18) {
    address public target;
    bytes public payload;
    bool public attempted;
    bool public succeeded;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        super.transferFrom(from, to, amount);
        if (target != address(0) && !attempted) {
            attempted = true;
            (succeeded,) = target.call(payload);
        }
        return true;
    }
}
