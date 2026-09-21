/**
 * `/api/admin/settings`: the Admin -> Settings page's backend.
 *   GET -> { settings, lastChange }
 *   PUT -> JSON { patch, updatedBy } -> { settings, lastChange } | { error: { kind, message } }
 * Both need the `x-admin-passcode` header when `ADMIN_PASSCODE` is set. See `handler.ts`.
 */
import { handleGet, handlePut } from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request): Promise<Response> {
  return handleGet(request);
}

export function PUT(request: Request): Promise<Response> {
  return handlePut(request);
}
