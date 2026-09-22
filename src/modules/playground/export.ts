/**
 * Getting corrected rows out of the playground, since nothing is saved
 * server-side: TSV for a spreadsheet, and the `expected.json` of an extractor
 * fixture (`fixtures/extractor/<name>/expected.json`). Pure builders; the
 * component does the clipboard and the download.
 */
import { findItem } from "@/catalog";
import { matchesCharacter, type RowValues } from "./review";

export const TSV_COLUMNS = ["Game time", "Character", "Item", "Quantity", "Image"] as const;

export interface TsvImage {
  fileName: string;
  rows: readonly RowValues[];
}

/**
 * One TSV cell: no tabs or line breaks, and nothing a spreadsheet would run as
 * a formula (a leading = + - @ gets an apostrophe, which Sheets and Excel hide).
 */
export function tsvCell(value: string): string {
  const flat = value.replace(/[\t\r\n]+/g, " ").trim();
  return /^[=+\-@]/.test(flat) ? `'${flat}` : flat;
}

/** Catalog name for an item id; "Unknown" for anything that is not tracked. */
export function exportItemName(itemId: string): string {
  return findItem(itemId)?.name ?? "Unknown";
}

export interface TsvOptions {
  header?: boolean;
  /** Only this character's rows (""; the rows without a name). Absent or null: every row. */
  character?: string | null;
}

/**
 * The whole batch as TSV: game timestamp, character, item name, quantity as
 * plain digits, image file name. One header line, one line per row, CRLF-free.
 */
export function buildTsv(images: readonly TsvImage[], options: TsvOptions = {}): string {
  const lines: string[] = [];
  const character = options.character ?? null;
  if (options.header ?? true) lines.push(TSV_COLUMNS.join("\t"));
  for (const image of images) {
    for (const row of image.rows) {
      if (!matchesCharacter(row, character)) continue;
      lines.push(
        [
          tsvCell(row.gameTimestamp),
          tsvCell(row.character),
          tsvCell(exportItemName(row.itemId)),
          // Plain digits: a spreadsheet must not meet "500,000,000" as text.
          /^\d+$/.test(row.quantity) ? row.quantity : tsvCell(row.quantity),
          tsvCell(image.fileName || "Pasted image"),
        ].join("\t"),
      );
    }
  }
  return lines.join("\n");
}

export interface FixtureExpected {
  looksLikeBankLog: boolean;
  rows: RowValues[];
}

/** The `expected.json` of an extractor fixture, from one image's corrected rows. */
export function buildFixture(looksLikeBankLog: boolean, rows: readonly RowValues[]): FixtureExpected {
  return {
    looksLikeBankLog,
    rows: looksLikeBankLog
      ? rows.map((row) => ({
          itemId: row.itemId,
          quantity: row.quantity,
          gameTimestamp: row.gameTimestamp,
          character: row.character,
        }))
      : [],
  };
}

/** Formatted like the files in `fixtures/extractor/`: two spaces, trailing newline. */
export function fixtureJson(fixture: FixtureExpected): string {
  return `${JSON.stringify(fixture, null, 2)}\n`;
}

/** "Bank Log 07.09 (2).png" -> "bank-log-07-09-2.expected.json". */
export function fixtureFileName(imageFileName: string): string {
  const base = imageFileName
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${base || "screenshot"}.expected.json`;
}
