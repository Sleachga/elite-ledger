/**
 * `/api/try-extract`: the `/try` playground's backend.
 *   GET  -> { passcodeRequired, enabled }
 *   POST -> multipart `image` -> { result, durationMs } | { error: { kind, message } }
 * See `handler.ts` for the gate, limits and error mapping.
 */
import { handleGet, handlePost } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** One extraction takes 10-20 s; leave room for a slow fallback run. */
export const maxDuration = 120;

export function GET(): Response {
  return handleGet();
}

export function POST(request: Request): Promise<Response> {
  return handlePost(request);
}
