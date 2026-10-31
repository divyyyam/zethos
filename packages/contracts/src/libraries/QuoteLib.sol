// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IZethosVault} from "../interfaces/IZethosVault.sol";

/// @notice EIP-712 struct hashing for `IZethosVault.Quote`.
/// @dev The type string must equal `QUOTE_TYPE_STRING` in `packages/shared/src/eip712.ts`.
library QuoteLib {
    bytes32 internal constant TYPEHASH = keccak256(
        "Quote(address taker,address tokenIn,address tokenOut,uint256 amountIn,uint256 amountOut,uint256 nonce,uint64 issuedAt,uint64 expiry)"
    );

    function hash(IZethosVault.Quote calldata quote) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TYPEHASH,
                quote.taker,
                quote.tokenIn,
                quote.tokenOut,
                quote.amountIn,
                quote.amountOut,
                quote.nonce,
                quote.issuedAt,
                quote.expiry
            )
        );
    }
}
