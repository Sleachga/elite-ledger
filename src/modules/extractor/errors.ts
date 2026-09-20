import Anthropic from "@anthropic-ai/sdk";

export type ExtractorErrorKind =
  /** The model (and any fallback) declined the request: `stop_reason: "refusal"`. */
  | "refusal"
  /** HTTP 429. Retry after a delay. */
  | "rate_limit"
  /** Any other API-side failure (4xx/5xx, overloaded, unexpected SDK error). */
  | "api"
  /** The request never got a response (DNS, TLS, reset, timeout). */
  | "network"
  /** A response arrived but could not be used: truncated, not JSON, off-schema. */
  | "invalid_output"
  /** The caller's setup is wrong: no/invalid API key, bad effort value, missing icon. */
  | "config";

export interface ExtractorErrorOptions {
  cause?: unknown;
  /** HTTP status, when the failure came from an API response. */
  status?: number;
  /** Seconds the API asked us to wait (`retry-after`), when present. */
  retryAfterSeconds?: number;
}

/**
 * The only error type that leaves the extractor module. Callers switch on
 * `kind`; the original SDK error (if any) is kept on `cause` for logging.
 */
export class ExtractorError extends Error {
  readonly kind: ExtractorErrorKind;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(kind: ExtractorErrorKind, message: string, options: ExtractorErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ExtractorError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }

  /** Worth retrying unchanged after a pause. */
  get retryable(): boolean {
    if (this.kind === "rate_limit" || this.kind === "network") return true;
    return this.kind === "api" && this.status !== undefined && this.status >= 500;
  }
}

function retryAfterSeconds(headers: Headers | undefined): number | undefined {
  const raw = headers?.get("retry-after");
  if (!raw) return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

/**
 * Map anything thrown by the SDK call onto an ExtractorError. Most specific
 * class first: in the TypeScript SDK `APIConnectionError` and the status
 * classes all extend `APIError`, so `APIError` has to come last.
 */
export function toExtractorError(error: unknown): ExtractorError {
  if (error instanceof ExtractorError) return error;

  if (error instanceof Anthropic.RateLimitError) {
    return new ExtractorError("rate_limit", `Anthropic API rate limit hit: ${error.message}`, {
      cause: error,
      status: error.status,
      retryAfterSeconds: retryAfterSeconds(error.headers),
    });
  }
  if (error instanceof Anthropic.AuthenticationError) {
    return new ExtractorError(
      "config",
      `Anthropic API rejected the credentials (check ANTHROPIC_API_KEY): ${error.message}`,
      { cause: error, status: error.status },
    );
  }
  if (error instanceof Anthropic.APIConnectionError) {
    // Includes APIConnectionTimeoutError.
    return new ExtractorError("network", `Could not reach the Anthropic API: ${error.message}`, {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new ExtractorError("api", `Anthropic API error: ${error.message}`, {
      cause: error,
      status: error.status,
    });
  }
  if (error instanceof Anthropic.AnthropicError) {
    return new ExtractorError("api", `Anthropic SDK error: ${error.message}`, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new ExtractorError("api", `Unexpected error calling the Anthropic API: ${message}`, {
    cause: error,
  });
}
