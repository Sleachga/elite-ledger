/**
 * The human-review layer over extracted rows, as a pure reducer: per image, the
 * rows as the extractor read them, the values a person corrected them to, and
 * the flags the verify UI needs (checked / edited / added / deleted).
 *
 * This is the seed of the real verify screen (CLAUDE.md decision 6), so it
 * knows nothing about `/try`: it takes rows in and hands corrected rows out.
 * Browser-safe and side-effect free; only type imports from the extractor.
 */
import { findItem } from "@/catalog";
import type { ParsedRow } from "@/modules/extractor";
import { CONFIDENCE_HIGH } from "./index";

/** The row's vertical extent on the screenshot, as fractions 0–1 of its height. */
export interface RowBox {
  top: number;
  bottom: number;
}

function field(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;
}

/**
 * `row.box`, if the extractor sent a usable one. The field is newer than this
 * code and may be missing, null, or nonsense: anything but two finite numbers
 * with `bottom` below `top` (after clamping to 0–1) reads as "no box".
 */
export function rowBox(row: unknown): RowBox | null {
  const box = field(row, "box");
  const top = field(box, "top");
  const bottom = field(box, "bottom");
  if (typeof top !== "number" || typeof bottom !== "number") return null;
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return null;
  const clamped = { top: Math.min(1, Math.max(0, top)), bottom: Math.min(1, Math.max(0, bottom)) };
  return clamped.bottom > clamped.top ? clamped : null;
}

/** `row.quantityText`: the amount exactly as displayed ("500,000,000"), or null when absent or blank. */
export function rowQuantityText(row: unknown): string | null {
  const text = field(row, "quantityText");
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed === "" ? null : trimmed;
}

/** The fields a person can correct; also the shape of a fixture row. */
export interface RowValues {
  itemId: string;
  quantity: string;
  gameTimestamp: string;
  character: string;
}

export const UNKNOWN_ITEM_ID = "unknown";

export type LookReason = "low_confidence" | "unknown_item" | "fragment" | "silver" | "quantity_text";

export interface LookInput {
  itemId: string;
  quantity: string;
  /** null for a row a person added: there is no model confidence to doubt. */
  confidence: number | null;
  quantityText?: string | null;
}

/** "2000" (a stack overlay) or "500,000,000" (grouped). "5,00,000" and "500,000,00" are not. */
const WELL_FORMED_AMOUNT = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/;

/**
 * Why a row needs an explicit check by a person, or [] when it may start
 * accepted. The extractor is weakest on the four blueprint fragments and on
 * Silver Coin magnitudes, so those always get a look, whatever the confidence.
 */
export function lookReasons(row: LookInput): LookReason[] {
  const reasons: LookReason[] = [];
  if (row.confidence !== null && !(row.confidence >= CONFIDENCE_HIGH)) reasons.push("low_confidence");

  const item = findItem(row.itemId);
  if (!item) reasons.push("unknown_item");
  else if (item.kind === "fragment") reasons.push("fragment");
  else if (item.kind === "currency") reasons.push("silver");

  const text = row.quantityText?.trim();
  if (text && (!WELL_FORMED_AMOUNT.test(text) || text.replaceAll(",", "") !== row.quantity)) {
    reasons.push("quantity_text");
  }
  return reasons;
}

export function needsLook(row: LookInput): boolean {
  return lookReasons(row).length > 0;
}

export interface ReviewRow {
  /** Stable within its image: "r3" for the fourth extracted row, "a1" for the first added one. */
  id: string;
  /** As extracted; null for a row a person added. */
  original: RowValues | null;
  /** What counts: totals, exports and the summary read these. */
  current: RowValues;
  confidence: number | null;
  lowConfidenceReason?: string;
  iconDescription: string;
  box: RowBox | null;
  quantityText: string | null;
  checked: boolean;
  /** The check is the automatic one a safe row starts with; any human touch clears it. */
  auto: boolean;
  /** `current` differs from `original`. */
  edited: boolean;
  added: boolean;
  deleted: boolean;
}

export interface ImageReview {
  /** Which read these rows came from; a re-read of the image starts the review over. */
  token: number;
  rows: ReviewRow[];
  /** Added-row ids already handed out. */
  addedCount: number;
}

/** Reviews by image (queue entry) id. */
export type ReviewState = Readonly<Record<string, ImageReview>>;

export const initialReviewState: ReviewState = {};

function valuesOf(row: RowValues): RowValues {
  return {
    itemId: row.itemId,
    quantity: row.quantity,
    gameTimestamp: row.gameTimestamp,
    character: row.character,
  };
}

function sameValues(a: RowValues, b: RowValues): boolean {
  return (
    a.itemId === b.itemId &&
    a.quantity === b.quantity &&
    a.gameTimestamp === b.gameTimestamp &&
    a.character === b.character
  );
}

/** The reasons a review row needs a look, judged on its current values. */
export function rowLookReasons(row: ReviewRow): LookReason[] {
  return lookReasons({
    itemId: row.current.itemId,
    quantity: row.current.quantity,
    confidence: row.confidence,
    // Once a person typed the quantity, what the model transcribed is beside the point.
    quantityText: row.original && row.original.quantity === row.current.quantity ? row.quantityText : null,
  });
}

export function rowNeedsLook(row: ReviewRow): boolean {
  return rowLookReasons(row).length > 0;
}

function extractedRow(row: ParsedRow, index: number): ReviewRow {
  const original = valuesOf(row);
  const quantityText = rowQuantityText(row);
  const safe = !needsLook({ ...original, confidence: row.confidence, quantityText });
  return {
    id: `r${index}`,
    original,
    current: original,
    confidence: row.confidence,
    ...(row.lowConfidenceReason ? { lowConfidenceReason: row.lowConfidenceReason } : {}),
    iconDescription: row.iconDescription ?? "",
    box: rowBox(row),
    quantityText,
    checked: safe,
    auto: safe,
    edited: false,
    added: false,
    deleted: false,
  };
}

/** A fresh review of one image's extracted rows: safe rows start accepted, the rest unchecked. */
export function createImageReview(rows: readonly ParsedRow[], token = 0): ImageReview {
  return { token, rows: rows.map(extractedRow), addedCount: 0 };
}

export type ReviewAction =
  /** Start (or restart) the review of an image from its extracted rows. */
  | { type: "init"; imageId: string; rows: readonly ParsedRow[]; token?: number }
  | { type: "setItem"; imageId: string; rowId: string; itemId: string }
  | { type: "setQuantity"; imageId: string; rowId: string; quantity: string }
  | { type: "setTimestamp"; imageId: string; rowId: string; gameTimestamp: string }
  | { type: "setCharacter"; imageId: string; rowId: string; character: string }
  | { type: "toggleChecked"; imageId: string; rowId: string }
  /** "Accept all": only rows that do not need a look. */
  | { type: "checkAllSafe"; imageId: string }
  | { type: "deleteRow"; imageId: string; rowId: string }
  | { type: "restoreRow"; imageId: string; rowId: string }
  | { type: "addRow"; imageId: string; values: RowValues }
  /** Back to what was extracted: the whole image, or one row with `rowId`. */
  | { type: "reset"; imageId: string; rowId?: string }
  | { type: "drop"; imageId: string };

const REVIEW_ACTION_TYPES: ReadonlySet<string> = new Set<ReviewAction["type"]>([
  "init",
  "setItem",
  "setQuantity",
  "setTimestamp",
  "setCharacter",
  "toggleChecked",
  "checkAllSafe",
  "deleteRow",
  "restoreRow",
  "addRow",
  "reset",
  "drop",
]);

export function isReviewAction(action: { type: string }): action is ReviewAction {
  return REVIEW_ACTION_TYPES.has(action.type);
}

function mapRow(
  state: ReviewState,
  imageId: string,
  rowId: string,
  change: (row: ReviewRow) => ReviewRow,
): ReviewState {
  const image = state[imageId];
  if (!image) return state;
  let changed = false;
  const rows = image.rows.map((row) => {
    if (row.id !== rowId) return row;
    const next = change(row);
    if (next !== row) changed = true;
    return next;
  });
  return changed ? { ...state, [imageId]: { ...image, rows } } : state;
}

/** A corrected field. Item and quantity are the fields that matter: correcting one also checks the row. */
function withValue(row: ReviewRow, patch: Partial<RowValues>, checks: boolean): ReviewRow {
  const current = { ...row.current, ...patch };
  if (sameValues(current, row.current)) return row;
  return {
    ...row,
    current,
    edited: row.original !== null && !sameValues(current, row.original),
    ...(checks ? { checked: true, auto: false } : {}),
  };
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "init":
      return { ...state, [action.imageId]: createImageReview(action.rows, action.token ?? 0) };

    case "setItem":
      return mapRow(state, action.imageId, action.rowId, (row) =>
        withValue(row, { itemId: action.itemId }, true),
      );

    case "setQuantity":
      // Only ever a positive integer digit string; the UI parses with `parseQuantityInput` first.
      if (!/^[1-9]\d*$/.test(action.quantity)) return state;
      return mapRow(state, action.imageId, action.rowId, (row) =>
        withValue(row, { quantity: action.quantity }, true),
      );

    case "setTimestamp":
      return mapRow(state, action.imageId, action.rowId, (row) =>
        withValue(row, { gameTimestamp: action.gameTimestamp.trim() }, false),
      );

    case "setCharacter":
      return mapRow(state, action.imageId, action.rowId, (row) =>
        withValue(row, { character: action.character.trim() }, false),
      );

    case "toggleChecked":
      return mapRow(state, action.imageId, action.rowId, (row) =>
        row.deleted ? row : { ...row, checked: !row.checked, auto: false },
      );

    case "checkAllSafe": {
      const image = state[action.imageId];
      if (!image) return state;
      let changed = false;
      const rows = image.rows.map((row) => {
        if (row.deleted || (row.checked && !row.auto) || rowNeedsLook(row)) return row;
        changed = true;
        return { ...row, checked: true, auto: false };
      });
      return changed ? { ...state, [action.imageId]: { ...image, rows } } : state;
    }

    case "deleteRow":
      return mapRow(state, action.imageId, action.rowId, (row) =>
        row.deleted ? row : { ...row, deleted: true },
      );

    case "restoreRow":
      return mapRow(state, action.imageId, action.rowId, (row) =>
        row.deleted ? { ...row, deleted: false } : row,
      );

    case "addRow": {
      const image = state[action.imageId];
      if (!image) return state;
      const values = valuesOf(action.values);
      if (!/^[1-9]\d*$/.test(values.quantity)) return state;
      const addedCount = image.addedCount + 1;
      const row: ReviewRow = {
        id: `a${addedCount}`,
        original: null,
        current: { ...values, gameTimestamp: values.gameTimestamp.trim(), character: values.character.trim() },
        confidence: null,
        iconDescription: "",
        box: null,
        quantityText: null,
        // A person typed it: that is the check.
        checked: true,
        auto: false,
        edited: false,
        added: true,
        deleted: false,
      };
      return { ...state, [action.imageId]: { ...image, rows: [...image.rows, row], addedCount } };
    }

    case "reset": {
      const image = state[action.imageId];
      if (!image) return state;
      const pristine = (row: ReviewRow): ReviewRow => {
        const original = row.original as RowValues;
        const safe = !needsLook({ ...original, confidence: row.confidence, quantityText: row.quantityText });
        return { ...row, current: original, checked: safe, auto: safe, edited: false, deleted: false };
      };
      const rows =
        action.rowId === undefined
          ? image.rows.filter((row) => !row.added).map(pristine)
          : image.rows.flatMap((row) => {
              if (row.id !== action.rowId) return [row];
              return row.added ? [] : [pristine(row)];
            });
      return { ...state, [action.imageId]: { ...image, rows } };
    }

    case "drop": {
      if (!(action.imageId in state)) return state;
      const next = { ...state };
      delete next[action.imageId];
      return next;
    }
  }
}

/** One finished read, as the queue knows it. */
export interface ReviewSource {
  imageId: string;
  /** Changes when the image is read again (the queue's `finishedAt`). */
  token: number;
  rows: readonly ParsedRow[];
}

/**
 * Keep the reviews in step with the finished reads: a new read gets a fresh
 * review, a re-read replaces it, an image that left the batch loses it.
 * Returns the same state when nothing changed.
 */
export function reconcileReviews(state: ReviewState, sources: readonly ReviewSource[]): ReviewState {
  const next: Record<string, ImageReview> = {};
  let changed = false;
  for (const source of sources) {
    const existing = state[source.imageId];
    if (existing && existing.token === source.token) {
      next[source.imageId] = existing;
    } else {
      next[source.imageId] = createImageReview(source.rows, source.token);
      changed = true;
    }
  }
  if (!changed && Object.keys(state).length === sources.length) return state;
  return next;
}

/** Rows that count: not deleted, in display order. */
export function activeRows(image: ImageReview | undefined): ReviewRow[] {
  return image ? image.rows.filter((row) => !row.deleted) : [];
}

export function deletedRows(image: ImageReview | undefined): ReviewRow[] {
  return image ? image.rows.filter((row) => row.deleted) : [];
}

/** The corrected values of the rows that count. */
export function correctedRows(image: ImageReview | undefined): RowValues[] {
  return activeRows(image).map((row) => row.current);
}

export interface ReviewCounts {
  /** Rows that count (deleted ones do not). */
  rows: number;
  /** Rows still waiting for a person's check. */
  toCheck: number;
  edited: number;
  added: number;
  deleted: number;
  /** Rows "Accept all" would change: safe ones that are unchecked or only auto-accepted. */
  acceptable: number;
}

export function reviewCounts(image: ImageReview | undefined): ReviewCounts {
  const counts: ReviewCounts = { rows: 0, toCheck: 0, edited: 0, added: 0, deleted: 0, acceptable: 0 };
  for (const row of image?.rows ?? []) {
    if (row.deleted) {
      counts.deleted += 1;
      continue;
    }
    counts.rows += 1;
    if (!row.checked) counts.toCheck += 1;
    if (row.edited) counts.edited += 1;
    if (row.added) counts.added += 1;
    if ((!row.checked || row.auto) && !rowNeedsLook(row)) counts.acceptable += 1;
  }
  return counts;
}

/** `reviewCounts` summed over a batch. */
export function batchReviewCounts(images: readonly (ImageReview | undefined)[]): ReviewCounts {
  const total: ReviewCounts = { rows: 0, toCheck: 0, edited: 0, added: 0, deleted: 0, acceptable: 0 };
  for (const image of images) {
    const counts = reviewCounts(image);
    for (const key of Object.keys(total) as (keyof ReviewCounts)[]) total[key] += counts[key];
  }
  return total;
}

/** What "Add row" starts from: the timestamp and character of the last row that counts. */
export function addRowDefaults(image: ImageReview | undefined): Pick<RowValues, "gameTimestamp" | "character"> {
  const last = activeRows(image).at(-1);
  return { gameTimestamp: last?.current.gameTimestamp ?? "", character: last?.current.character ?? "" };
}
