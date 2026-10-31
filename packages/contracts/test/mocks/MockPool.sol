// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @notice A pool with a settable price and nothing else.
contract MockPool is IUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint160 public sqrtPriceX96;

    constructor(address tokenA, address tokenB, uint160 sqrtPriceX96_) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function setSqrtPrice(uint160 sqrtPriceX96_) external {
        sqrtPriceX96 = sqrtPriceX96_;
    }

    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint8, bool) {
        return (sqrtPriceX96, 0, 0, 0, 0, 0, true);
    }
}
