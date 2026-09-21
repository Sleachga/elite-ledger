/**
 * Small pieces every passcode-gated route shares (`/api/try-extract`,
 * `/api/admin/*`): a constant-time passcode compare, the client key for the
 * rate limiter, and an uncached JSON response.
 */
import { createHash, timingSafeEqual } from "node:crypto";

/** An env var that holds a passcode, or undefined when unset or blank. */
export function envPasscode(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Constant-time: both sides are hashed first, so length does not leak either. */
export function passcodeMatches(given: string, expected: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/** Per-client key for the rate limiter: the first forwarded address, as Vercel sets it. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

export function jsonNoStore(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}
