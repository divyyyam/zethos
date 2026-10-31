// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IUniswapV3Pool} from "../interfaces/IUniswapV3Pool.sol";
import {IZethosVault} from "../interfaces/IZethosVault.sol";

/// @notice Reads what a Uniswap-v3-style pool's current price implies for a given input.
library PoolPrice {
    uint256 private constant Q96 = 2 ** 96;

    /// @notice The output at the pool's spot price, before its fee and price impact.
    /// @dev The pool's price is token1 per token0, or (sqrtPriceX96 / 2^96)^2. Dividing by 2^96 in
    /// two steps keeps intermediates in range. An uninitialized pool reverts: protection that
    /// quietly switches off would be worse than none.
    function spotOutput(address pool, address tokenIn, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        (uint160 sqrtPriceX96,,,,,,) = IUniswapV3Pool(pool).slot0();
        if (sqrtPriceX96 == 0) revert IZethosVault.PoolUnavailable();
        if (IUniswapV3Pool(pool).token0() == tokenIn) {
            return Math.mulDiv(Math.mulDiv(amountIn, sqrtPriceX96, Q96), sqrtPriceX96, Q96);
        }
        return Math.mulDiv(Math.mulDiv(amountIn, Q96, sqrtPriceX96), Q96, sqrtPriceX96);
    }

    /// @notice Reverts unless `pool` trades exactly `tokenA` and `tokenB`, in either order.
    function requireTokens(address pool, address tokenA, address tokenB) internal view {
        address token0 = IUniswapV3Pool(pool).token0();
        address token1 = IUniswapV3Pool(pool).token1();
        bool sameOrder = token0 == tokenA && token1 == tokenB;
        bool flipped = token0 == tokenB && token1 == tokenA;
        if (!sameOrder && !flipped) revert IZethosVault.PoolTokensMismatch();
    }
}
