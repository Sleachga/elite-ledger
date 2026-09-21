/**
 * Logic behind `/api/admin/settings` (the Admin -> Settings page). Beside
 * `route.ts` for the same reason as the playground's handler: a route file may
 * only export its HTTP methods, and the tests need `resetRateLimit`.
 *
 * Until Discord auth (#4) exists the admin area has its own passcode, separate
 * from the playground's:
 *  - `ADMIN_PASSCODE` set: the `x-admin-passcode` header must match (401);
 *  - `ADMIN_PASSCODE` unset on Vercel: the admin area is off (503);
 *  - `ADMIN_PASSCODE` unset locally: open.
 * Once #4 lands this moves behind the admin allowlist and every change goes
 * through Audit (#11).
 */
import { z } from "zod";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientKey, envPasscode, jsonNoStore as json, passcodeMatches } from "@/lib/request-gate";
import { MAX_UPDATED_BY_LENGTH, getSettingsInfo, settingsPatchSchema, updateSettings } from "@/modules/settings";
import {
  ADMIN_PASSCODE_HEADER,
  toAdminSettingsBody,
  type AdminErrorBody,
  type AdminErrorKind,
} from "@/modules/settings/api";

/** Per IP, reads and writes together. Generous for a person, slow for a passcode guesser. */
export const RATE_LIMIT = { limit: 30, windowMs: 10 * 60 * 1000 } as const;
/** A settings update is a few dozen bytes. */
const MAX_BODY_BYTES = 8 * 1024;

const limiter = createRateLimiter(RATE_LIMIT);

/** Test hook: forget every rate-limit window. */
export function resetRateLimit(): void {
  limiter.reset();
}

const updateSchema = z.strictObject({
  patch: settingsPatchSchema.refine((patch) => Object.keys(patch).length > 0, "patch must change at least one setting"),
  updatedBy: z
    .string()
    .trim()
    .min(1, "updatedBy is required")
    .max(MAX_UPDATED_BY_LENGTH, `updatedBy is at most ${MAX_UPDATED_BY_LENGTH} characters`),
});

function fail(status: number, kind: AdminErrorKind, message: string, headers?: Record<string, string>): Response {
  const body: AdminErrorBody = { error: { kind, message } };
  return json(body, status, headers);
}

/** null when the caller may go on; otherwise the refusal. Same order as the playground: off, rate limit, passcode. */
function refuse(request: Request): Response | null {
  const expected = envPasscode("ADMIN_PASSCODE");
  if (expected === undefined && process.env.VERCEL) {
    return fail(503, "disabled", "Admin disabled: ADMIN_PASSCODE is not set on this deployment.");
  }

  // Before the passcode check, so guessing passcodes is limited too.
  const decision = limiter.take(clientKey(request));
  if (!decision.allowed) {
    return fail(429, "too_many_requests", `Too many requests. Try again in ${decision.retryAfterSeconds} seconds.`, {
      "Retry-After": String(decision.retryAfterSeconds),
    });
  }

  if (expected !== undefined) {
    const given = request.headers.get(ADMIN_PASSCODE_HEADER) ?? "";
    if (given === "" || !passcodeMatches(given, expected)) {
      return fail(401, "unauthorized", "Wrong or missing admin passcode.");
    }
  }
  return null;
}

export async function handleGet(request: Request): Promise<Response> {
  const refusal = refuse(request);
  if (refusal) return refusal;
  return json(toAdminSettingsBody(await getSettingsInfo()), 200);
}

export async function handlePut(request: Request): Promise<Response> {
  const refusal = refuse(request);
  if (refusal) return refusal;

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, "bad_request", "The request body could not be read.");
  }
  if (raw.length > MAX_BODY_BYTES) return fail(400, "bad_request", "The request body is too large.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return fail(400, "bad_request", "Send a JSON body: { patch, updatedBy }.");
  }

  const parsed = updateSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => (issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
      .join("; ");
    return fail(400, "bad_request", `Invalid settings update. ${detail}`);
  }

  try {
    const info = await updateSettings(parsed.data.patch, { updatedBy: parsed.data.updatedBy });
    return json(toAdminSettingsBody(info), 200);
  } catch (error) {
    console.error("[admin/settings] could not save", error);
    return fail(500, "database", "The settings could not be saved. Is the database migrated?");
  }
}
