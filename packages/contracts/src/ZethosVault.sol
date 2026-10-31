// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IZethosVault} from "./interfaces/IZethosVault.sol";
import {PoolPrice} from "./libraries/PoolPrice.sol";
import {QuoteLib} from "./libraries/QuoteLib.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ZethosVault
/// @notice The engine proposes prices; this contract decides whether a trade is allowed. It trusts
/// neither the engine nor the UI, and enforces every guarantee at settlement time.
/// @dev Three separate keys: a cold owner (funds, configuration), a hot quote signer (signatures
/// only) and a hot executor (pause only). The security model is in `packages/contracts/README.md`.
contract ZethosVault is IZethosVault, Ownable2Step, Pausable, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @inheritdoc IZethosVault
    uint64 public constant MAX_TTL_CEILING = 120;
    /// @inheritdoc IZethosVault
    uint64 public constant MAX_CLOCK_SKEW = 30;
    /// @inheritdoc IZethosVault
    bytes32 public constant QUOTE_TYPEHASH = QuoteLib.TYPEHASH;

    uint256 private constant BPS_DENOMINATOR = 10_000;

    /// @inheritdoc IZethosVault
    address public quoteSigner;
    /// @inheritdoc IZethosVault
    address public executor;
    /// @inheritdoc IZethosVault
    uint64 public maxTtl;

    mapping(address tokenIn => mapping(address tokenOut => Route)) private _routes;
    mapping(address taker => mapping(uint256 nonce => bool)) private _usedNonces;

    constructor(address owner_, address quoteSigner_, address executor_, uint64 maxTtl_)
        Ownable(owner_)
        EIP712("Zethos", "1")
    {
        _requireDistinctRoles(owner_, quoteSigner_, executor_);
        _setMaxTtl(maxTtl_);
        quoteSigner = quoteSigner_;
        executor = executor_;
        emit QuoteSignerUpdated(quoteSigner_);
        emit ExecutorUpdated(executor_);
    }

    // --- Settlement ---

    /// @inheritdoc IZethosVault
    function fill(Quote calldata quote, bytes calldata signature) external nonReentrant {
        _requireValidQuote(quote, signature);
        _requireNotPaused();
        uint256 poolOut = _requireAcceptedByRoute(quote);
        _settle(quote, poolOut);
    }

    // --- Emergency stop ---

    /// @inheritdoc IZethosVault
    function pause() external {
        if (msg.sender != owner() && msg.sender != executor) revert NotOwnerOrExecutor();
        _pause();
    }

    /// @inheritdoc IZethosVault
    function unpause() external onlyOwner {
        _unpause();
    }

    // --- Inventory ---

    /// @inheritdoc IZethosVault
    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposit(token, amount);
    }

    /// @inheritdoc IZethosVault
    function withdraw(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Withdraw(token, to, amount);
    }

    // --- Configuration ---

    /// @inheritdoc IZethosVault
    function setQuoteSigner(address quoteSigner_) external onlyOwner {
        _requireDistinctRoles(owner(), quoteSigner_, executor);
        if (quoteSigner_ == pendingOwner()) revert RolesMustDiffer();
        quoteSigner = quoteSigner_;
        emit QuoteSignerUpdated(quoteSigner_);
    }

    /// @inheritdoc IZethosVault
    function setExecutor(address executor_) external onlyOwner {
        _requireDistinctRoles(owner(), quoteSigner, executor_);
        if (executor_ == pendingOwner()) revert RolesMustDiffer();
        executor = executor_;
        emit ExecutorUpdated(executor_);
    }

    /// @inheritdoc IZethosVault
    function setMaxTtl(uint64 maxTtl_) external onlyOwner {
        _setMaxTtl(maxTtl_);
    }

    /// @inheritdoc IZethosVault
    function setRoute(address tokenIn, address tokenOut, Route calldata route) external onlyOwner {
        if (tokenIn == tokenOut || route.poolToleranceBps > BPS_DENOMINATOR) {
            revert InvalidConfig();
        }
        if (tokenIn.code.length == 0) revert NotAContract(tokenIn);
        if (tokenOut.code.length == 0) revert NotAContract(tokenOut);
        if (route.pool != address(0)) PoolPrice.requireTokens(route.pool, tokenIn, tokenOut);
        _routes[tokenIn][tokenOut] = route;
        emit RouteUpdated(tokenIn, tokenOut, route);
    }

    /// @notice Starts a two-step ownership transfer. The cold owner can't collapse into a hot role.
    function transferOwnership(address newOwner) public override {
        if (newOwner == quoteSigner || newOwner == executor) revert RolesMustDiffer();
        super.transferOwnership(newOwner);
    }

    /// @notice Always reverts for the owner: an ownerless vault could never withdraw or unpause.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    // --- Views ---

    /// @inheritdoc IZethosVault
    function isNonceUsed(address taker, uint256 nonce) external view returns (bool) {
        return _usedNonces[taker][nonce];
    }

    /// @inheritdoc IZethosVault
    function routeOf(address tokenIn, address tokenOut) external view returns (Route memory) {
        return _routes[tokenIn][tokenOut];
    }

    /// @inheritdoc IZethosVault
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @inheritdoc IZethosVault
    function quoteDigest(Quote calldata quote) public view returns (bytes32) {
        return _hashTypedDataV4(QuoteLib.hash(quote));
    }

    // --- Internals ---

    /// @dev Who may fill, and whether the quote itself is still good. Runs before the vault's own
    /// state is consulted, in the same order as the engine's paper vault, so both fail alike.
    function _requireValidQuote(Quote calldata quote, bytes calldata signature) private view {
        if (msg.sender != quote.taker) revert NotTaker();

        (address recovered, ECDSA.RecoverError failure,) =
            ECDSA.tryRecover(quoteDigest(quote), signature);
        if (failure != ECDSA.RecoverError.NoError || recovered != quoteSigner) {
            revert InvalidSignature();
        }

        if (block.timestamp > quote.expiry) revert QuoteExpired(quote.expiry);
        // Without this, a future `issuedAt` would stretch a quote past the lifetime limit below.
        if (quote.issuedAt > block.timestamp + MAX_CLOCK_SKEW) {
            revert QuoteNotYetValid(quote.issuedAt);
        }
        if (quote.expiry <= quote.issuedAt || quote.expiry - quote.issuedAt > maxTtl) {
            revert TtlTooLong();
        }
        if (_usedNonces[quote.taker][quote.nonce]) revert NonceUsed();
    }

    /// @dev Whether the vault takes this trade right now. Returns the pool's spot output, or 0.
    function _requireAcceptedByRoute(Quote calldata quote) private view returns (uint256 poolOut) {
        Route memory route = _routes[quote.tokenIn][quote.tokenOut];
        if (!route.enabled) revert RouteDisabled();
        if (quote.amountIn == 0 || quote.amountOut == 0) revert InvalidAmount();
        if (quote.amountIn > route.maxAmountIn) revert SizeCapExceeded(route.maxAmountIn);

        if (route.pool != address(0)) {
            poolOut = PoolPrice.spotOutput(route.pool, quote.tokenIn, quote.amountIn);
            uint256 minimumOut =
                Math.mulDiv(poolOut, BPS_DENOMINATOR - route.poolToleranceBps, BPS_DENOMINATOR);
            if (quote.amountOut < minimumOut) revert WorseThanPool(minimumOut);
        }

        uint256 available = IERC20(quote.tokenOut).balanceOf(address(this));
        if (quote.amountOut > available) revert InsufficientInventory(available);
    }

    /// @dev Spends the nonce, then moves both legs.
    function _settle(Quote calldata quote, uint256 poolOut) private {
        _usedNonces[quote.taker][quote.nonce] = true;

        IERC20 tokenIn = IERC20(quote.tokenIn);
        uint256 balanceBefore = tokenIn.balanceOf(address(this));
        tokenIn.safeTransferFrom(quote.taker, address(this), quote.amountIn);
        // A token that delivers less than the signed amount would break the signed price.
        if (tokenIn.balanceOf(address(this)) - balanceBefore != quote.amountIn) {
            revert UnsupportedToken();
        }
        IERC20(quote.tokenOut).safeTransfer(quote.taker, quote.amountOut);

        emit Fill(
            quote.taker,
            quote.tokenIn,
            quote.tokenOut,
            quote.amountIn,
            quote.amountOut,
            quote.nonce,
            poolOut
        );
    }

    function _setMaxTtl(uint64 maxTtl_) private {
        if (maxTtl_ == 0 || maxTtl_ > MAX_TTL_CEILING) revert InvalidConfig();
        maxTtl = maxTtl_;
        emit MaxTtlUpdated(maxTtl_);
    }

    function _requireDistinctRoles(address owner_, address quoteSigner_, address executor_)
        private
        pure
    {
        if (quoteSigner_ == address(0) || executor_ == address(0)) revert ZeroAddress();
        if (owner_ == quoteSigner_ || owner_ == executor_ || quoteSigner_ == executor_) {
            revert RolesMustDiffer();
        }
    }
}
