// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice A contract taker, so a token callback can re-enter the vault as the real taker.
contract ContractTaker {
    function execute(address target, bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory result) = target.call(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
        return result;
    }
}
