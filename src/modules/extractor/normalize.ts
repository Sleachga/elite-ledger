/**
 * The rules the extractor owns, applied to the model's raw structured output.
 * Pure: no network, no clock, no filesystem.
 *
 *  - deposits only (CLAUDE.md decision 3): every non-deposit row is dropped
 *    here, not by the model and not by the UI;
 *  - quantities stay decimal strings end to end, so 10,000,000,000 silver
 *    survives (never routed through `Number`);
 *  - item ids are limited to the catalog plus "unknown";
 *  - an image that is not a bank log yields no rows.
 */
import { UNKNOWN_ITEM, type ModelOutput, type ModelRow } from "./schema";

export interface ParsedRow {
  /** A catalog item id, or "unknown". */
  itemId: string;
  /** Short text description of the icon (input for the text-only second judge). */
  iconDescription: string;
  /** Decimal digits only, bigint-safe. */
  quantity: string;
  /** Exactly as displayed, e.g. "06.09.2026 - 23:21". */
  gameTimestamp: string;
  character: string;
  direction: "deposit";
  /** 0–1. */
  confidence: number;
  lowConfidenceReason?: string;
}

export interface NormalizedOutput {
  looksLikeBankLog: boolean;
  rows: ParsedRow[];
  /** Distinct character names on the kept rows, in order of first appearance. */
  characters: string[];
  warnings: string[];
}

/** Confidence ceiling for a row whose item id or quantity we had to replace. */
export const REPAIRED_ROW_CONFIDENCE = 0.3;
/** Confidence ceiling for a row with an odd-looking timestamp or no name. */
export const SUSPECT_ROW_CONFIDENCE = 0.5;

const TIMESTAMP_PATTERN = /^\d{2}\.\d{2}\.\d{4} - \d{2}:\d{2}$/;
// Thousands separators seen in game UIs: comma, dot, apostrophe, underscore and
// any whitespace (`\s` covers no-break and thin spaces).
const SEPARATORS = /[\s,.'’_]/g;

export type QuantityResult = { ok: true; value: string } | { ok: false; raw: string };

/**
 * "500,000,000" -> "500000000"; null / "" -> "1" (no overlay means a stack
 * of one); anything that is not a positive integer -> not ok.
 */
export function normalizeQuantity(raw: string | null | undefined): QuantityResult {
  if (raw === null || raw === undefined) return { ok: true, value: "1" };
  const stripped = raw.replace(SEPARATORS, "");
  if (stripped === "") return { ok: true, value: "1" };
  if (!/^\d+$/.test(stripped)) return { ok: false, raw };
  const value = stripped.replace(/^0+/, "");
  if (value === "") return { ok: false, raw }; // "0": not a possible deposit
  return { ok: true, value };
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normalizeRow(row: ModelRow, itemIds: ReadonlySet<string>): ParsedRow {
  let confidence = clampConfidence(row.confidence);
  const reasons: string[] = [];
  const modelReason = row.lowConfidenceReason?.trim();
  if (modelReason) reasons.push(modelReason);

  const cap = (ceiling: number, reason: string) => {
    confidence = Math.min(confidence, ceiling);
    reasons.push(reason);
  };

  let itemId = row.itemId.trim();
  if (itemId !== UNKNOWN_ITEM && !itemIds.has(itemId)) {
    cap(REPAIRED_ROW_CONFIDENCE, `Model returned an item id that is not tracked ("${itemId}").`);
    itemId = UNKNOWN_ITEM;
  }

  const quantity = normalizeQuantity(row.quantity);
  if (!quantity.ok) {
    cap(REPAIRED_ROW_CONFIDENCE, `Quantity could not be read ("${quantity.raw}"); defaulted to 1.`);
  }

  const gameTimestamp = row.gameTimestamp.trim();
  if (!TIMESTAMP_PATTERN.test(gameTimestamp)) {
    cap(SUSPECT_ROW_CONFIDENCE, "Timestamp is not in the usual DD.MM.YYYY - HH:MM form.");
  }

  const character = row.character.trim();
  if (character === "") cap(SUSPECT_ROW_CONFIDENCE, "Character name could not be read.");

  return {
    itemId,
    iconDescription: row.iconDescription.trim(),
    quantity: quantity.ok ? quantity.value : "1",
    gameTimestamp,
    character,
    direction: "deposit",
    confidence,
    ...(reasons.length > 0 ? { lowConfidenceReason: reasons.join(" ") } : {}),
  };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function normalizeOutput(
  output: ModelOutput,
  catalogItemIds: Iterable<string>,
): NormalizedOutput {
  const warnings = output.notes.map((note) => note.trim()).filter((note) => note !== "");

  if (!output.looksLikeBankLog) {
    const ignored =
      output.rows.length > 0 ? ` (${plural(output.rows.length, "row")} ignored)` : "";
    return {
      looksLikeBankLog: false,
      rows: [],
      characters: [],
      warnings: [`The image does not look like a guild bank log${ignored}.`, ...warnings],
    };
  }

  const itemIds = new Set(catalogItemIds);
  const deposits = output.rows.filter((row) => row.direction === "deposit");
  const dropped = output.rows.length - deposits.length;
  if (dropped > 0) {
    const withdraws = output.rows.filter((row) => row.direction === "withdraw").length;
    const unclear = dropped - withdraws;
    const detail = [
      withdraws > 0 ? plural(withdraws, "withdrawal") : "",
      unclear > 0 ? `${unclear} with no clear deposit arrow` : "",
    ]
      .filter(Boolean)
      .join(", ");
    warnings.unshift(`Dropped ${plural(dropped, "non-deposit row")} (${detail}).`);
  }

  const rows = deposits.map((row) => normalizeRow(row, itemIds));
  const characters = [...new Set(rows.map((row) => row.character).filter((name) => name !== ""))];

  return { looksLikeBankLog: true, rows, characters, warnings };
}
