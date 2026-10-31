// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {QuoteLib} from "../../src/libraries/QuoteLib.sol";
import {VaultTest} from "../base/VaultTest.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Pins the vault to what the off-chain stack produces. The expected values were generated
/// with viem from `packages/shared/src/eip712.ts`, and the SDK accepts the signature below.
/// If one of these fails, the contract and the engine no longer agree on what a quote is.
contract Eip712CompatibilityTest is VaultTest {
    address private constant FIXTURE_VAULT = 0x4444444444444444444444444444444444444444;
    address private constant FIXTURE_SIGNER = 0x5d5c99EdF529335160FF180fA141Dd4967fc00D2;
    bytes32 private constant STRUCT_HASH =
        0x4dcb3f3c357ff130efc87df8f1cd447bace1ee5afb85ea229715e1d5bb724847;
    bytes32 private constant DOMAIN_SEPARATOR =
        0xd89d60257c494fc8c050e734a08866131f51ab3cc0c205b0ff7570ea80562a7f;
    bytes32 private constant DIGEST =
        0xe6b8f8ffd32f07520e3b3f30d11363bb4c4e4a9731a5ccae1c385a33f9ac0a00;
    bytes private constant SIGNATURE =
        hex"9bd3fa5657fa50ebc1f2dcbad791a461e183f6b343bd3e5657219060d190df1f4bdd0f7c9fa39020b098339485da2f580fe055e32aa7d09b4bd108c2fd009b821b";

    function setUp() public override {
        super.setUp();
        vm.chainId(177);
        vm.etch(FIXTURE_VAULT, address(vault).code);
    }

    function _fixture() private pure returns (IZethosVault.Quote memory) {
        return IZethosVault.Quote({
            taker: 0x1111111111111111111111111111111111111111,
            tokenIn: 0x2222222222222222222222222222222222222222,
            tokenOut: 0x3333333333333333333333333333333333333333,
            amountIn: 1_000_000,
            amountOut: 12_000_000_000_000_000_000,
            nonce: 37,
            issuedAt: 1_800_000_000,
            expiry: 1_800_000_030
        });
    }

    function structHashOf(IZethosVault.Quote calldata quote) external pure returns (bytes32) {
        return QuoteLib.hash(quote);
    }

    function test_TypeHashMatchesSharedTypeString() public view {
        assertEq(
            vault.QUOTE_TYPEHASH(),
            keccak256(
                "Quote(address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 nonce,uint64 issuedAt,uint64 expiry)"
            )
        );
    }

    function test_StructHashMatchesViem() public view {
        assertEq(this.structHashOf(_fixture()), STRUCT_HASH);
    }

    function test_DomainSeparatorMatchesViem() public view {
        assertEq(IZethosVault(FIXTURE_VAULT).DOMAIN_SEPARATOR(), DOMAIN_SEPARATOR);
    }

    function test_DigestMatchesViem() public view {
        assertEq(IZethosVault(FIXTURE_VAULT).quoteDigest(_fixture()), DIGEST);
    }

    function test_ViemSignatureRecoversToItsSigner() public pure {
        (address recovered, ECDSA.RecoverError failure,) = ECDSA.tryRecover(DIGEST, SIGNATURE);
        assertTrue(failure == ECDSA.RecoverError.NoError);
        assertEq(recovered, FIXTURE_SIGNER);
    }
}
