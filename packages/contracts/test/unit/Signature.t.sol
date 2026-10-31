// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ZethosVault} from "../../src/ZethosVault.sol";
import {IZethosVault} from "../../src/interfaces/IZethosVault.sol";
import {QuoteLib} from "../../src/libraries/QuoteLib.sol";
import {VaultTest} from "../base/VaultTest.sol";

contract SignatureTest is VaultTest {
    /// @dev secp256k1 group order.
    uint256 private constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    function _expectInvalid(IZethosVault.Quote memory quote, bytes memory signature) private {
        vm.prank(quote.taker);
        vm.expectRevert(IZethosVault.InvalidSignature.selector);
        vault.fill(quote, signature);
    }

    function test_RevertsForWrongSigner() public {
        IZethosVault.Quote memory quote = _quote(1);
        _expectInvalid(quote, _sign(OTHER_KEY, quote));
    }

    function test_RevertsForMalformedSignature() public {
        _expectInvalid(_quote(1), hex"1234");
    }

    function test_RevertsForHighS() public {
        IZethosVault.Quote memory quote = _quote(1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, vault.quoteDigest(quote));
        bytes32 flippedS = bytes32(N - uint256(s));
        _expectInvalid(quote, abi.encodePacked(r, flippedS, v == 27 ? uint8(28) : uint8(27)));
    }

    function test_EveryQuoteFieldIsBound() public {
        IZethosVault.Quote memory signed = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, signed);

        IZethosVault.Quote memory tampered = _quote(1);
        tampered.tokenIn = address(whsk);
        _expectInvalid(tampered, signature);

        tampered = _quote(1);
        tampered.tokenOut = address(usdt);
        _expectInvalid(tampered, signature);

        tampered = _quote(1);
        tampered.amountIn -= 1;
        _expectInvalid(tampered, signature);

        tampered = _quote(1);
        tampered.amountOut += 1;
        _expectInvalid(tampered, signature);

        tampered = _quote(2);
        _expectInvalid(tampered, signature);

        tampered = _quote(1);
        tampered.issuedAt -= 1;
        _expectInvalid(tampered, signature);

        tampered = _quote(1);
        tampered.expiry += 1;
        _expectInvalid(tampered, signature);
    }

    function test_SignatureForAnotherVaultIsRejected() public {
        ZethosVault other = new ZethosVault(owner, signer, executor, 120);
        IZethosVault.Quote memory quote = _quote(1);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, other.quoteDigest(quote));
        _expectInvalid(quote, abi.encodePacked(r, s, v));
    }

    function test_SignatureForAnotherChainIsRejected() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.chainId(block.chainid + 1);
        _expectInvalid(quote, signature);
    }

    /// @dev Paper quotes are signed against the zero address, so they can never fill a real vault.
    function test_PaperQuoteSignatureIsRejected() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes32 paperDomain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("Zethos"),
                keccak256("1"),
                block.chainid,
                address(0)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked(hex"1901", paperDomain, _structHash(quote)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        _expectInvalid(quote, abi.encodePacked(r, s, v));
    }

    function test_RotatingTheSignerInvalidatesQuotesInFlight() public {
        IZethosVault.Quote memory quote = _quote(1);
        bytes memory signature = _sign(SIGNER_KEY, quote);
        vm.prank(owner);
        vault.setQuoteSigner(vm.addr(OTHER_KEY));
        _expectInvalid(quote, signature);
    }

    function _structHash(IZethosVault.Quote memory quote) private view returns (bytes32) {
        return this.structHashOf(quote);
    }

    function structHashOf(IZethosVault.Quote calldata quote) external pure returns (bytes32) {
        return QuoteLib.hash(quote);
    }
}
