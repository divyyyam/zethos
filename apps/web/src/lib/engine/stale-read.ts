// ERC20InsufficientAllowance(address,uint256,uint256), the OpenZeppelin error.
const INSUFFICIENT_ALLOWANCE = /ERC20InsufficientAllowance|0xfb8f41b2/i;

/**
 * Public RPCs sit behind load balancers, so a node can answer after another has already returned the
 * approval's receipt. To it the allowance still looks short, though the approval has been mined.
 */
export function isStaleAllowance(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  return INSUFFICIENT_ALLOWANCE.test(`${cause.message} ${String(cause.cause ?? "")}`);
}

/**
 * Retries only that lag. Any other failure, and the last attempt's, throws unchanged.
 * `beforeRetry` runs before each wait, so the caller can stop when the quote is no longer usable.
 */
export async function retryWhileAllowanceLags<T>(
  action: () => Promise<T>,
  {
    attempts = 8,
    delayMs = 1500,
    beforeRetry = () => {},
  }: { attempts?: number; delayMs?: number; beforeRetry?: () => void } = {},
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await action();
    } catch (cause) {
      if (attempt >= attempts || !isStaleAllowance(cause)) throw cause;
      beforeRetry();
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
