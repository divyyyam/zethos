// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IZethosVault
/// @notice Settles firm swap quotes signed off-chain against the vault's own inventory.
interface IZethosVault {
    /// @notice A firm price for one taker. Mirrors `Quote` in `packages/shared/src/eip712.ts`.
    /// @param taker The only address allowed to fill the quote.
    /// @param tokenIn The token the taker pays.
    /// @param tokenOut The token the taker receives.
    /// @param amountIn Exact amount paid, in raw units of `tokenIn`.
    /// @param amountOut Exact amount received, in raw units of `tokenOut`.
    /// @param nonce Single-use value, scoped to the taker.
    /// @param issuedAt When the quote was signed, in Unix seconds.
    /// @param expiry Last second the quote can be filled, in Unix seconds.
    struct Quote {
        address taker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 nonce;
        uint64 issuedAt;
        uint64 expiry;
    }

    /// @notice What the vault accepts in one direction of a pair.
    /// @param pool Optional pool whose spot price is a floor for fills. Zero means no pool check.
    /// @param poolToleranceBps How far below pool spot a fill may land. Spot ignores the pool's
    /// fee and price impact, so a real pool output always sits somewhat below it.
    /// @param enabled Whether fills are accepted in this direction.
    /// @param maxAmountIn Largest `amountIn` for one fill, in raw units of the input token.
    struct Route {
        address pool;
        uint16 poolToleranceBps;
        bool enabled;
        uint256 maxAmountIn;
    }

    /// @notice A quote settled. `poolOut` is the pool's spot output then, or 0 with no pool.
    event Fill(
        address indexed taker,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 nonce,
        uint256 poolOut
    );
    event Deposit(address indexed token, uint256 amount);
    event Withdraw(address indexed token, address indexed to, uint256 amount);
    event QuoteSignerUpdated(address indexed quoteSigner);
    event ExecutorUpdated(address indexed executor);
    event MaxTtlUpdated(uint64 maxTtl);
    event RouteUpdated(address indexed tokenIn, address indexed tokenOut, Route route);

    /// @notice The caller is not the quote's taker.
    error NotTaker();
    /// @notice The signature is malformed or wasn't made by the current quote signer.
    error InvalidSignature();
    /// @notice The quote's last valid second has passed.
    error QuoteExpired(uint64 expiry);
    /// @notice The quote claims to be issued further in the future than clock skew explains.
    error QuoteNotYetValid(uint64 issuedAt);
    /// @notice The quote's lifetime is empty, or longer than `maxTtl`.
    error TtlTooLong();
    /// @notice The taker has already used this nonce.
    error NonceUsed();
    /// @notice The vault doesn't accept this token direction.
    error RouteDisabled();
    /// @notice One of the quote's amounts is zero.
    error InvalidAmount();
    /// @notice `amountIn` is above the route's per-fill limit.
    error SizeCapExceeded(uint256 maxAmountIn);
    /// @notice `amountOut` is below what the route's pool protection requires.
    error WorseThanPool(uint256 minimumOut);
    /// @notice The vault holds less of `tokenOut` than the quote pays out.
    error InsufficientInventory(uint256 available);
    /// @notice The input token delivered something other than the signed amount.
    error UnsupportedToken();
    /// @notice The route's pool isn't initialized.
    error PoolUnavailable();
    /// @notice The route's pool doesn't trade the route's two tokens.
    error PoolTokensMismatch();
    /// @notice Owner, quote signer and executor must be three different addresses.
    error RolesMustDiffer();
    error ZeroAddress();
    /// @notice A token address has no code.
    error NotAContract(address account);
    /// @notice A configuration value is outside its allowed range.
    error InvalidConfig();
    error NotOwnerOrExecutor();
    /// @notice An ownerless vault could never withdraw or unpause.
    error RenounceDisabled();

    /// @notice Settles a signed quote. Both legs move, or neither does.
    /// @dev The caller must be the taker and must have approved `amountIn` to this contract.
    function fill(Quote calldata quote, bytes calldata signature) external;

    /// @notice Stops all fills. Callable by the owner or the executor.
    function pause() external;

    /// @notice Resumes fills. Owner only, so a hot key can't undo an emergency stop.
    function unpause() external;

    /// @notice Pulls inventory from the owner, who must have approved `amount`.
    function deposit(address token, uint256 amount) external;

    /// @notice Sends inventory out. Works while paused, so a pause can never trap funds.
    function withdraw(address token, address to, uint256 amount) external;

    /// @notice Replaces the quote signer. Quotes signed by the old key stop being fillable at once.
    function setQuoteSigner(address quoteSigner_) external;

    function setExecutor(address executor_) external;

    /// @notice Sets the longest accepted quote lifetime, up to `MAX_TTL_CEILING`.
    function setMaxTtl(uint64 maxTtl_) external;

    /// @notice Configures one direction of a pair. Set both directions to trade both ways.
    function setRoute(address tokenIn, address tokenOut, Route calldata route) external;

    /// @notice The hot key whose signatures are accepted. It can sign, and can't move funds.
    function quoteSigner() external view returns (address);

    /// @notice The hot key allowed to pause. It can't unpause or move funds.
    function executor() external view returns (address);

    /// @notice The longest accepted `expiry - issuedAt`, in seconds.
    function maxTtl() external view returns (uint64);

    /// @notice Hard ceiling on `maxTtl`, in seconds.
    function MAX_TTL_CEILING() external view returns (uint64);

    /// @notice How far ahead of block time `issuedAt` may be, in seconds.
    function MAX_CLOCK_SKEW() external view returns (uint64);

    /// @notice The EIP-712 type hash of `Quote`.
    function QUOTE_TYPEHASH() external view returns (bytes32);

    /// @notice The EIP-712 domain separator: Zethos, version 1, this chain, this contract.
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    function isNonceUsed(address taker, uint256 nonce) external view returns (bool);

    function routeOf(address tokenIn, address tokenOut) external view returns (Route memory);

    /// @notice The EIP-712 digest the quote signer signs for `quote`.
    function quoteDigest(Quote calldata quote) external view returns (bytes32);
}
