export type EngineErrorCode =
  | "paused"
  | "pair_halted"
  | "vault_capacity"
  | "insufficient_reference_depth"
  | "rate_limited"
  | "invalid_request"
  | "taker_restricted"
  | "warming_up"
  | "quote_expired"
  | "quote_invalid"
  | "nonce_used"
  | "assistant_unavailable"
  | "assistant_timeout"
  | "unauthorized"
  | "not_found"
  | "wrong_mode";

export type SdkErrorCode =
  | "invalid_response"
  | "network"
  | "timeout"
  | "unverified_quote"
  | "wrong_mode";

/** Engine or SDK code. Unknown engine codes pass through; bodies without a code become `http_<status>`. */
export type ZethosErrorCode = EngineErrorCode | SdkErrorCode | (string & {});

export class ZethosError extends Error {
  readonly code: ZethosErrorCode;
  /** HTTP status, or 0 when the error was raised by the SDK. */
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ZethosErrorCode, message: string, status = 0, details?: unknown) {
    super(message);
    this.name = "ZethosError";
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}
