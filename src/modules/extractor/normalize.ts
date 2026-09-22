/**
 * The rules the extractor owns, applied to the model's raw structured output.
 * Pure: no network, no clock, no filesystem.
 *
 *  - deposits only (CLAUDE.md decision 3): every non-deposit row is dropped
 *    here, not by the model and not by the UI;
 *  - quantities stay decimal strings end to end, so 10,000,000,000 silver
 *    survives (never routed through `Number`);
 *  - the amount is read twice (`quantityText` as printed, `quantity` as
 *    digits); the thousands grouping of the printed form is checked and the
 *    two readings have to agree;
 *  - item ids are limited to the catalog plus "unknown";
 *  - an item's identity is its art and its border: when the border colour
 *    the model saw stands for a rarity whose border differs from the chosen
 *    item's, the row becomes "unknown" (the same art with another border is
 *    another item); a border it could not see caps the row's confidence;
 *  - blueprint-fragment and Silver Coin rows never come back confident: a
 *    wrong fragment or a wrong magnitude costs too much, so a human always
 *    looks (issue #19);
 *  - an image that is not a bank log yields no rows.
 */
import { rarityBorderWord, sameBorderColor, type CatalogItem } from "@/catalog";
import {
  BORDER_COLORS,
  UNKNOWN_ITEM,
  isRarity,
  type BorderColor,
  type ModelOutput,
  type ModelRow,
} from "./schema";

/** A row's vertical extent as fractions (0-1) of the image height, `top < bottom`. */
export interface RowBox {
  top: number;
  bottom: number;
}

export interface ParsedRow {
  /** A catalog item id, or "unknown". */
  itemId: string;
  /** Short text description of the icon (input for the text-only second judge). */
  iconDescription: string;
  /**
   * The rarity the icon's border colour stands for as the model saw it, or
   * "none" / "unclear". Absent when the model did not report it. A value
   * that disagrees with the item's rarity has already turned `itemId` into
   * "unknown".
   */
  borderColor?: BorderColor;
  /** The border's colour in the model's own word ("blue"), "" for no border. Absent when not reported. */
  borderColorWord?: string;
  /** Decimal digits only, bigint-safe. */
  quantity: string;
  /**
   * The amount as displayed, separators included ("500,000,000", "1000"), or
   * "" when the row shows no number. Absent when the model did not report it.
   */
  quantityText?: string;
  /**
   * Where the row is in the screenshot. Fractions of the image height, so it
   * applies to the uploaded image whatever size was sent to the model. Absent
   * when the model gave none or gave one that makes no sense.
   */
  box?: RowBox;
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
  /** Top to bottom when every row has a box, otherwise in the model's order. */
  rows: ParsedRow[];
  /** Distinct character names on the kept rows, in order of first appearance. */
  characters: string[];
  warnings: string[];
}

/** Confidence ceiling for a row whose item id or quantity we had to replace. */
export const REPAIRED_ROW_CONFIDENCE = 0.3;
/** Confidence ceiling for a row with an odd-looking timestamp, amount, no name, or a border that contradicts the item. */
export const SUSPECT_ROW_CONFIDENCE = 0.5;
/** Confidence ceiling for a row whose border the model could not see, so the rarity went unchecked. */
export const UNSEEN_BORDER_CONFIDENCE = 0.7;
/** Confidence ceiling for rows a human must always look at: fragments and money. */
export const ALWAYS_CHECKED_CONFIDENCE = 0.8;

export const FRAGMENT_REASON = "Blueprint fragments are always double-checked.";
export const MONEY_REASON = "Money amounts are always double-checked.";

const TIMESTAMP_PATTERN = /^\d{2}\.\d{2}\.\d{4} - \d{2}:\d{2}$/;
// Thousands separators seen in game UIs: comma, dot, apostrophe, underscore and
// any whitespace (`\s` covers no-break and thin spaces).
const SEPARATORS = /[\s,.'’_]/g;
const HAS_SEPARATOR = /[\s,.'’_]/;
/** One to three digits, then groups of exactly three. */
const GROUPED_AMOUNT = /^\d{1,3}(?:[\s,.'’_]\d{3})*$/;

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

export type AmountIssue =
  /** `quantityText` has separators that are not in groups of three, or stray characters. */
  | "malformed"
  /** Both readings are well-formed but say different numbers. */
  | "mismatch"
  /** Neither reading is a positive integer. */
  | "unreadable";

export interface AmountResult {
  /** Decimal digits only. "1" when nothing usable was read. */
  value: string;
  issue?: AmountIssue;
}

/**
 * Reconcile the two readings of a row's amount: `quantityText`, copied from
 * the screen with its separators, and `quantity`, the same number as digits.
 *
 *  - no `quantityText` (older answers): `quantity` alone decides;
 *  - a `quantityText` with separators must be groups of three
 *    ("1,250,000", not "1,25,000" or "12,50"): a dropped or doubled digit
 *    breaks the grouping, which is how a magnitude slip shows;
 *  - when both are well-formed but differ, the printed form wins: it is the
 *    one transcribed straight from the pixels.
 */
export function checkAmount(
  quantityText: string | null | undefined,
  quantity: string | null | undefined,
): AmountResult {
  const digits = normalizeQuantity(quantity);
  const text = quantityText?.trim();
  if (text === undefined) {
    return digits.ok ? { value: digits.value } : { value: "1", issue: "unreadable" };
  }

  const wellFormed = HAS_SEPARATOR.test(text) ? GROUPED_AMOUNT.test(text) : /^\d*$/.test(text);
  const printed = normalizeQuantity(text);
  if (!wellFormed || !printed.ok) {
    if (digits.ok) return { value: digits.value, issue: "malformed" };
    return printed.ok ? { value: printed.value, issue: "malformed" } : { value: "1", issue: "unreadable" };
  }
  if (!digits.ok) return { value: printed.value, issue: "mismatch" };
  if (digits.value !== printed.value) {
    // An empty printed form next to a real number: the number carries the information.
    return { value: text === "" ? digits.value : printed.value, issue: "mismatch" };
  }
  return { value: printed.value };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? clamp01(value) : 0;
}

/**
 * `{ top, bottom }` clamped to 0–1, or undefined when it is not two finite
 * numbers with `top < bottom` (pixel coordinates, for instance, collapse to
 * 1/1 and are dropped).
 */
export function normalizeBox(raw: unknown): RowBox | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { top, bottom } = raw as Record<string, unknown>;
  if (typeof top !== "number" || typeof bottom !== "number") return undefined;
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return undefined;
  const box = { top: clamp01(top), bottom: clamp01(bottom) };
  return box.top < box.bottom ? box : undefined;
}

/** Top to bottom, but only when every row says where it is; otherwise the given order stands. */
export function sortByBox<Row extends { box?: RowBox }>(rows: readonly Row[]): Row[] {
  if (rows.length === 0 || !rows.every((row) => row.box !== undefined)) return [...rows];
  // Array.prototype.sort is stable: rows at the same height keep their order.
  return [...rows].sort((a, b) => (a.box as RowBox).top - (b.box as RowBox).top);
}

export interface RowBorder {
  /** What the model reported, mapped onto the closed set (an off-list value counts as "unclear"). */
  color: BorderColor;
  /** The model's own colour word, or the off-list value it gave, or "". */
  word: string;
}

/**
 * The model's `borderColor` / `borderColorWord` as a `RowBorder`, or
 * undefined when the answer predates the fields. An off-list `borderColor`
 * (a fallback model writing "blue" into the enum slot) becomes "unclear" and
 * is kept as the word.
 */
export function normalizeBorder(
  borderColor: string | null | undefined,
  borderColorWord: string | null | undefined,
): RowBorder | undefined {
  const raw = borderColor?.trim() ?? "";
  const word = borderColorWord?.trim() ?? "";
  if (raw === "" && borderColorWord === undefined) return undefined;
  if (raw === "") return { color: "unclear", word };
  if ((BORDER_COLORS as readonly string[]).includes(raw)) return { color: raw as BorderColor, word };
  return { color: "unclear", word: word || raw };
}

type ItemInfo = Pick<CatalogItem, "kind" | "rarity" | "name">;
type Items = ReadonlyMap<string, ItemInfo>;

function normalizeRow(row: ModelRow, items: Items): ParsedRow {
  let confidence = clampConfidence(row.confidence);
  const reasons: string[] = [];
  const modelReason = row.lowConfidenceReason?.trim();
  if (modelReason) reasons.push(modelReason);

  const cap = (ceiling: number, reason: string) => {
    confidence = Math.min(confidence, ceiling);
    reasons.push(reason);
  };

  let itemId = row.itemId.trim();
  if (itemId !== UNKNOWN_ITEM && !items.has(itemId)) {
    cap(REPAIRED_ROW_CONFIDENCE, `Model returned an item id that is not tracked ("${itemId}").`);
    itemId = UNKNOWN_ITEM;
  }

  // Identity is art and border. Currency has no border in the log, so it is
  // left out; an "unknown" row has nothing to check against.
  const border = normalizeBorder(row.borderColor, row.borderColorWord);
  const picked = items.get(itemId);
  if (border && picked && picked.kind !== "currency") {
    const seen = border.word ? `${border.color} ("${border.word}")` : border.color;
    if (isRarity(border.color)) {
      if (!sameBorderColor(border.color, picked.rarity)) {
        cap(
          SUSPECT_ROW_CONFIDENCE,
          `Border color ${seen} does not match ${picked.name} (${picked.rarity}, ${rarityBorderWord(picked.rarity)} border); item set to unknown.`,
        );
        itemId = UNKNOWN_ITEM;
      }
    } else if (border.color === "none") {
      cap(UNSEEN_BORDER_CONFIDENCE, "No border was seen around the icon, so its rarity could not be checked.");
    } else {
      cap(UNSEEN_BORDER_CONFIDENCE, "The border color could not be made out, so the item's rarity could not be checked.");
    }
  }
  const kind = items.get(itemId)?.kind;

  const quantityText = row.quantityText?.trim();
  const amount = checkAmount(row.quantityText, row.quantity);
  const shown = JSON.stringify(quantityText ?? row.quantity ?? "");
  if (amount.issue === "unreadable") {
    cap(REPAIRED_ROW_CONFIDENCE, `Quantity could not be read (${shown}); defaulted to 1.`);
  } else if (amount.issue === "malformed") {
    cap(
      SUSPECT_ROW_CONFIDENCE,
      `The amount looked malformed (${shown} is not in groups of three digits); check it against the screenshot.`,
    );
  } else if (amount.issue === "mismatch") {
    cap(
      SUSPECT_ROW_CONFIDENCE,
      `The amount was read two ways (${shown} and ${JSON.stringify(row.quantity ?? "")}); kept ${amount.value}.`,
    );
  }

  const gameTimestamp = row.gameTimestamp.trim();
  if (!TIMESTAMP_PATTERN.test(gameTimestamp)) {
    cap(SUSPECT_ROW_CONFIDENCE, "Timestamp is not in the usual DD.MM.YYYY - HH:MM form.");
  }

  const character = row.character.trim();
  if (character === "") cap(SUSPECT_ROW_CONFIDENCE, "Character name could not be read.");

  if (kind === "fragment") cap(ALWAYS_CHECKED_CONFIDENCE, FRAGMENT_REASON);
  if (kind === "currency") {
    cap(ALWAYS_CHECKED_CONFIDENCE, MONEY_REASON);
    // The game prints money with separators; without them the grouping check had nothing to test.
    if (
      amount.issue === undefined &&
      amount.value.length > 3 &&
      quantityText !== undefined &&
      !HAS_SEPARATOR.test(quantityText)
    ) {
      reasons.push("The amount came without thousands separators, so its grouping could not be checked.");
    }
  }

  const box = normalizeBox(row.box);

  return {
    itemId,
    iconDescription: row.iconDescription.trim(),
    ...(border ? { borderColor: border.color, borderColorWord: border.word } : {}),
    quantity: amount.value,
    ...(quantityText !== undefined ? { quantityText } : {}),
    ...(box ? { box } : {}),
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
  catalog: readonly Pick<CatalogItem, "id" | "kind" | "rarity" | "name">[],
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

  const items: Items = new Map(
    catalog.map((item) => [item.id, { kind: item.kind, rarity: item.rarity, name: item.name }]),
  );
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

  const rows = sortByBox(deposits.map((row) => normalizeRow(row, items)));
  const characters = [...new Set(rows.map((row) => row.character).filter((name) => name !== ""))];

  return { looksLikeBankLog: true, rows, characters, warnings };
}
