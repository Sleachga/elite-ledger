/**
 * Logic behind `/api/try-extract` (the `/try` playground). Lives beside
 * `route.ts` because a Next.js route file may only export its HTTP methods and
 * route config; the tests need `resetRateLimit` as well.
 *
 * Every POST spends the owner's API credits. The gate is optional:
 *  - `TRY_PASSCODE` set: the `x-try-passcode` header must match;
 *  - `TRY_PASSCODE` unset: open (the owner accepts the cost; the rate limit
 *    below and the admin AI switch still apply).
 * On top of that an admin can switch AI reading off (the `aiExtractionEnabled`
 * setting): every POST is then refused with 403 `ai_disabled` before the rate
 * limiter or the extractor is touched, so no credits can be spent.
 *
 * Nothing is stored: the image goes to `extract()` and the rows go back.
 */
import { ExtractorError, extract, type ExtractorErrorKind } from "@/modules/extractor";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientKey, envPasscode, jsonNoStore as json, passcodeMatches } from "@/lib/request-gate";
import { getSettings } from "@/modules/settings";
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

/**
 * Per IP. The page sends one request per screenshot and a batch holds up to
 * 20, so the limit leaves room for a few full batches plus retries. The
 * passcode is the real gate; this only stops a client that loops.
 */
export const RATE_LIMIT = { limit: 60, windowMs: 10 * 60 * 1000 } as const;
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
  return envPasscode("TRY_PASSCODE");
}

function gate(): Pick<PlaygroundStatusBody, "passcodeRequired" | "enabled"> {
  const passcodeRequired = configuredPasscode() !== undefined;
  // Open without a passcode by the owner's choice; the admin AI switch is the kill switch.
  const enabled = true;
  return { passcodeRequired, enabled };
}

/** What the page needs before it sends anything: the gate, and the admin's upload-mode settings. */
export async function handleGet(): Promise<Response> {
  const settings = await getSettings();
  const body: PlaygroundStatusBody = {
    ...gate(),
    aiEnabled: settings.aiExtractionEnabled,
    defaultMode: settings.defaultUploadMode,
  };
  return json(body, 200);
}

export async function handlePost(request: Request): Promise<Response> {
  // The admin switch comes before everything that costs anything: no rate-limit slot, no extractor.
  if (!(await getSettings()).aiExtractionEnabled) {
    return fail(403, "ai_disabled", "AI reading of screenshots is switched off by an admin. Add rows by hand.");
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
