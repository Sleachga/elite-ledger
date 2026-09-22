/**
 * Playground ("Try the extractor"): pure helpers shared by the `/try` page and
 * the `POST /api/try-extract` route. Browser-safe: no Node imports, and only
 * type imports from the extractor so the Anthropic SDK never reaches the
 * client bundle.
 */
import type { ExtractionResult, ExtractorErrorKind, ImageMediaType, ParsedRow } from "@/modules/extractor";
import { formatQty } from "@/lib/format";
import type { UploadMode } from "./mode";

export const TRY_EXTRACT_ENDPOINT = "/api/try-extract";
export const PASSCODE_HEADER = "x-try-passcode";
export const IMAGE_FIELD = "image";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_MEDIA_TYPES: readonly ImageMediaType[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
];

export function isAcceptedMediaType(value: string): value is ImageMediaType {
  return (ACCEPTED_MEDIA_TYPES as readonly string[]).includes(value);
}

/** Kinds the route adds on top of the extractor's own. */
export type PlaygroundErrorKind =
  | ExtractorErrorKind
  | "bad_request"
  | "too_large"
  | "unauthorized"
  | "disabled"
  | "ai_disabled"
  | "too_many_requests";

export interface PlaygroundErrorBody {
  error: { kind: PlaygroundErrorKind; message: string };
}

export interface PlaygroundSuccessBody {
  result: ExtractionResult;
  durationMs: number;
}

/** `GET /api/try-extract`: what the page needs to know before it sends anything. */
export interface PlaygroundStatusBody {
  passcodeRequired: boolean;
  /** false: deployed without `TRY_PASSCODE`, so the endpoint answers 503. */
  enabled: boolean;
  /** The admin setting `aiExtractionEnabled`; false: the endpoint answers 403 `ai_disabled`. */
  aiEnabled: boolean;
  /** The admin setting `defaultUploadMode`. */
  defaultMode: UploadMode;
}

const ERROR_TEXT: Record<PlaygroundErrorKind, string> = {
  config: "The server has no API key configured.",
  rate_limit: "Busy, try again in a minute.",
  refusal: "The model declined to read this image. Try a tighter crop of just the bank log.",
  invalid_output: "The model's answer could not be used. Try again, or crop to fewer rows.",
  api: "The Claude API returned an error. Try again in a moment.",
  network: "The server could not reach the Claude API. Try again in a moment.",
  bad_request: "That file can't be used. Choose a PNG, JPEG or WebP screenshot.",
  too_large: "That image is too large. The limit is 10 MB.",
  unauthorized: "Wrong or missing passcode.",
  disabled: "The playground is switched off on this deployment.",
  ai_disabled: "AI reading is switched off by an admin. Add rows by hand.",
  too_many_requests: "Too many tries from this connection. Wait a few minutes.",
};

/** Plain-language text for an error kind; unknown kinds get a generic line. */
export function errorText(kind: string): string {
  return (ERROR_TEXT as Record<string, string>)[kind] ?? "Something went wrong. Try again.";
}

/**
 * "10000000000" -> "10,000,000,000". Quantities are digit strings end to end
 * and go through BigInt, never Number. Anything that is not all digits comes
 * back unchanged.
 */
export function formatQuantity(digits: string): string {
  return /^\d+$/.test(digits) ? formatQty(BigInt(digits)) : digits;
}

/**
 * "07.09.2026 - 18:02" -> "07.09 · 18:02" for dense rows: the year is on the
 * screenshot and in the full value (tooltip, editor). Anything that is not in
 * the game's usual form comes back unchanged.
 */
export function compactTimestamp(gameTimestamp: string): string {
  const match = /^(\d{2}\.\d{2})\.\d{4} - (\d{2}:\d{2})$/.exec(gameTimestamp.trim());
  return match ? `${match[1]} · ${match[2]}` : gameTimestamp;
}

export interface ItemTotal {
  itemId: string;
  total: bigint;
  /** Number of rows summed. */
  rows: number;
}

/** Summed quantity per item id, in order of first appearance. Non-digit quantities count as 0. */
export function totalsByItem(rows: readonly Pick<ParsedRow, "itemId" | "quantity">[]): ItemTotal[] {
  const totals = new Map<string, ItemTotal>();
  for (const row of rows) {
    const qty = /^\d+$/.test(row.quantity) ? BigInt(row.quantity) : 0n;
    const entry = totals.get(row.itemId);
    if (entry) {
      entry.total += qty;
      entry.rows += 1;
    } else {
      totals.set(row.itemId, { itemId: row.itemId, total: qty, rows: 1 });
    }
  }
  return [...totals.values()];
}

export type ConfidenceLevel = "high" | "medium" | "low";

export const CONFIDENCE_HIGH = 0.85;
export const CONFIDENCE_MEDIUM = 0.5;

/** green >= 0.85, amber 0.5-0.85, red < 0.5. */
export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_MEDIUM) return "medium";
  return "low";
}

export const CONFIDENCE_COLOR: Record<ConfidenceLevel, "green" | "amber" | "red"> = {
  high: "green",
  medium: "amber",
  low: "red",
};

/** 0.873 -> "87%". */
export function formatConfidence(confidence: number): string {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(confidence) ? confidence : 0));
  return `${Math.round(clamped * 100)}%`;
}

/** Why a file cannot be sent, or null when it can. Mirrors the route's checks. */
export function validateImageFile(file: { type: string; size: number }): PlaygroundErrorKind | null {
  if (!isAcceptedMediaType(file.type)) return "bad_request";
  if (file.size === 0) return "bad_request";
  if (file.size > MAX_IMAGE_BYTES) return "too_large";
  return null;
}

/**
 * The real type from the file's first bytes (PNG / JPEG / WebP signatures),
 * or null. The declared MIME type is whatever the client says it is.
 */
export function sniffMediaType(bytes: Uint8Array): ImageMediaType | null {
  const starts = (signature: number[], offset = 0) =>
    bytes.length >= offset + signature.length &&
    signature.every((value, index) => bytes[offset + index] === value);

  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}
