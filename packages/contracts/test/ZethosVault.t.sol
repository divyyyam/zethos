// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ZethosVault} from "../src/ZethosVault.sol";

// TODO: Replace with docs/onchain.md section 13 unit and invariant tests.
contract ZethosVaultTest {
    function test_ScaffoldDeploys() public {
        ZethosVault vault = new ZethosVault();
        require(address(vault).code.length > 0, "vault shell must deploy");
    }
}
