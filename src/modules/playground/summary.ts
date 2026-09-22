/**
 * Batch-level numbers for the `/try` summary strip: counts, combined per-item
 * totals and the per-character breakdown across every finished image. Pure and
 * browser-safe. Quantities are digit strings summed with BigInt, never Number.
 */
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import { confidenceLevel, totalsByItem, type ConfidenceLevel, type ItemTotal } from "./index";
import type { QueueEntry } from "./queue";

/** What the totals read from a row: an extracted `ParsedRow` and a corrected review row both fit. */
type CountedRow = Pick<ParsedRow, "itemId" | "quantity" | "character">;

/** An extraction result, or an image's corrected rows (`reviewedImages` in `batch.ts`). */
interface ResultRows<R extends CountedRow = CountedRow> {
  looksLikeBankLog: boolean;
  rows: readonly R[];
}

/** Rows that count: a result that is not a bank log contributes nothing. */
function countedRows<R extends CountedRow>(result: ResultRows<R>): readonly R[] {
  return result.looksLikeBankLog ? result.rows : [];
}

const UNKNOWN_ITEM_ID = "unknown";

/**
 * Per-item totals across results, in catalog order (`order` = catalog item
 * ids). Ids outside the catalog follow in order of first appearance, and
 * "unknown" stays its own bucket at the very end.
 */
export function combinedTotals(results: readonly ResultRows[], order: readonly string[]): ItemTotal[] {
  const totals = totalsByItem(results.flatMap((result) => countedRows(result)));
  const rank = new Map(order.map((id, index) => [id, index]));
  const position = (total: ItemTotal, index: number): [number, number] => {
    if (total.itemId === UNKNOWN_ITEM_ID) return [2, index];
    const catalogIndex = rank.get(total.itemId);
    return catalogIndex === undefined ? [1, index] : [0, catalogIndex];
  };
  return totals
    .map((total, index) => ({ total, key: position(total, index) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1])
    .map(({ total }) => total);
}

export interface CharacterTotal {
  /** As read from the log; "" when a row had no name. */
  character: string;
  rows: number;
  /** How many screenshots the character appears in. */
  images: number;
}

/** Deposit rows per character, most rows first (then by name). */
export function characterBreakdown(results: readonly ResultRows[]): CharacterTotal[] {
  const byName = new Map<string, CharacterTotal>();
  for (const result of results) {
    const seenHere = new Set<string>();
    for (const row of countedRows(result)) {
      const character = row.character.trim();
      let entry = byName.get(character);
      if (!entry) {
        entry = { character, rows: 0, images: 0 };
        byName.set(character, entry);
      }
      entry.rows += 1;
      if (!seenHere.has(character)) {
        seenHere.add(character);
        entry.images += 1;
      }
    }
  }
  return [...byName.values()].sort(
    (a, b) => b.rows - a.rows || a.character.localeCompare(b.character, "en"),
  );
}

/** Rows below "high" confidence: the ones the page flags for a second look. */
export function lowConfidenceCount(rows: readonly Pick<ParsedRow, "confidence">[]): number {
  return rows.filter((row) => confidenceLevel(row.confidence) !== "high").length;
}

/** The worst confidence level among flagged rows, or null when every row is "high". */
export function worstFlag(rows: readonly Pick<ParsedRow, "confidence">[]): Exclude<ConfidenceLevel, "high"> | null {
  let worst: Exclude<ConfidenceLevel, "high"> | null = null;
  for (const row of rows) {
    const level = confidenceLevel(row.confidence);
    if (level === "low") return "low";
    if (level === "medium") worst = "medium";
  }
  return worst;
}

/** The finished results of a batch, in list order. */
export function finishedResults(entries: readonly QueueEntry[]): ExtractionResult[] {
  return entries.flatMap((entry) => (entry.state === "done" && entry.body ? [entry.body.result] : []));
}

export interface BatchSummary {
  total: number;
  done: number;
  failed: number;
  reading: number;
  queued: number;
  canceled: number;
  /** Manual entries: nothing is read, the member types the rows. */
  ready: number;
  /** done + failed + canceled + ready: nothing more will happen to these on its own. */
  settled: number;
  /** Deposit rows across finished images. */
  rows: number;
  lowConfidenceRows: number;
  warnings: number;
  /** Finished images that did not look like a bank log. */
  notBankLog: number;
  /** Sum of the server-side read times of finished images. */
  durationMs: number;
}

export function summarize(entries: readonly QueueEntry[]): BatchSummary {
  const summary: BatchSummary = {
    total: entries.length,
    done: 0,
    failed: 0,
    reading: 0,
    queued: 0,
    canceled: 0,
    ready: 0,
    settled: 0,
    rows: 0,
    lowConfidenceRows: 0,
    warnings: 0,
    notBankLog: 0,
    durationMs: 0,
  };
  for (const entry of entries) {
    summary[entry.state] += 1;
    if (entry.state !== "done" || !entry.body) continue;
    const { result, durationMs } = entry.body;
    const rows = countedRows(result);
    summary.rows += rows.length;
    summary.lowConfidenceRows += lowConfidenceCount(rows);
    summary.warnings += result.warnings.length;
    if (!result.looksLikeBankLog) summary.notBankLog += 1;
    summary.durationMs += Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  }
  summary.settled = summary.done + summary.failed + summary.canceled + summary.ready;
  return summary;
}
