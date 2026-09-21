/**
 * Logic behind `/api/try-extract` (the `/try` playground). Lives beside
 * `route.ts` because a Next.js route file may only export its HTTP methods and
 * route config; the tests need `resetRateLimit` as well.
 *
 * Every POST spends the owner's API credits, so the gate is strict:
 *  - `TRY_PASSCODE` set: the `x-try-passcode` header must match;
 *  - `TRY_PASSCODE` unset on Vercel: the playground is off (503);
 *  - `TRY_PASSCODE` unset locally: open.
 *
 * Nothing is stored: the image goes to `extract()` and the rows go back.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { ExtractorError, extract, type ExtractorErrorKind } from "@/modules/extractor";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  IMAGE_FIELD,
  MAX_IMAGE_BYTES,
  PASSCODE_HEADER,
  isAcceptedMediaType,
  sniffMediaType,
  type PlaygroundErrorBody,
  type PlaygroundErrorKind,
  type PlaygroundStatusBody,
  type PlaygroundSuccessBody,
} from "@/modules/playground";

export const RATE_LIMIT = { limit: 10, windowMs: 10 * 60 * 1000 } as const;
/** Room for multipart boundaries and headers around a 10 MB file. */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 1024 * 1024;

const limiter = createRateLimiter(RATE_LIMIT);

/** Test hook: forget every rate-limit window. */
export function resetRateLimit(): void {
  limiter.reset();
}

const EXTRACTOR_STATUS: Record<ExtractorErrorKind, number> = {
  config: 500,
  rate_limit: 429,
  refusal: 422,
  invalid_output: 502,
  api: 502,
  network: 504,
};

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function fail(
  status: number,
  kind: PlaygroundErrorKind,
  message: string,
  headers?: Record<string, string>,
): Response {
  const body: PlaygroundErrorBody = { error: { kind, message } };
  return json(body, status, headers);
}

function configuredPasscode(): string | undefined {
  const value = process.env.TRY_PASSCODE?.trim();
  return value ? value : undefined;
}

function gate(): PlaygroundStatusBody {
  const passcodeRequired = configuredPasscode() !== undefined;
  // Deployed without a passcode: never run unauthenticated in production.
  const enabled = passcodeRequired || !process.env.VERCEL;
  return { passcodeRequired, enabled };
}

/** Constant-time: both sides are hashed first, so length does not leak either. */
function passcodeMatches(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function handleGet(): Response {
  return json(gate(), 200);
}

export async function handlePost(request: Request): Promise<Response> {
  const { enabled } = gate();
  if (!enabled) {
    return fail(503, "disabled", "Playground disabled: TRY_PASSCODE is not set on this deployment.");
  }

  // Before the passcode check, so guessing passcodes is limited too.
  const decision = limiter.take(clientKey(request));
  if (!decision.allowed) {
    return fail(
      429,
      "too_many_requests",
      `Too many requests. Try again in ${decision.retryAfterSeconds} seconds.`,
      { "Retry-After": String(decision.retryAfterSeconds) },
    );
  }

  const expected = configuredPasscode();
  if (expected !== undefined) {
    const given = request.headers.get(PASSCODE_HEADER) ?? "";
    if (given === "" || !passcodeMatches(given, expected)) {
      return fail(401, "unauthorized", "Wrong or missing passcode.");
    }
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return fail(413, "too_large", "The image is larger than 10 MB.");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_request", `Send multipart/form-data with an "${IMAGE_FIELD}" file field.`);
  }
  const file = form.get(IMAGE_FIELD);
  if (!(file instanceof File)) {
    return fail(400, "bad_request", `Missing "${IMAGE_FIELD}" file field.`);
  }
  if (!isAcceptedMediaType(file.type)) {
    return fail(400, "bad_request", "The image must be a PNG, JPEG or WebP file.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return fail(413, "too_large", "The image is larger than 10 MB.");
  }
  if (file.size === 0) {
    return fail(400, "bad_request", "The image is empty.");
  }

  const image = new Uint8Array(await file.arrayBuffer());
  // Trust the bytes over the declared type: that is what the API will see.
  const mediaType = sniffMediaType(image);
  if (!mediaType) {
    return fail(400, "bad_request", "The file is not a valid PNG, JPEG or WebP image.");
  }

  const startedAt = performance.now();
  try {
    const result = await extract({ image, mediaType });
    const body: PlaygroundSuccessBody = {
      result,
      durationMs: Math.round(performance.now() - startedAt),
    };
    return json(body, 200);
  } catch (error) {
    if (error instanceof ExtractorError) {
      console.error(`[try-extract] ${error.kind}: ${error.message}`);
      const headers =
        error.retryAfterSeconds !== undefined
          ? { "Retry-After": String(Math.ceil(error.retryAfterSeconds)) }
          : undefined;
      return fail(EXTRACTOR_STATUS[error.kind], error.kind, error.message, headers);
    }
    // extract() only throws ExtractorError; anything else is a bug here.
    console.error("[try-extract] unexpected error", error);
    return fail(500, "api", "Unexpected server error.");
  }
}
