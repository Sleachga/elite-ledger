/**
 * What "Confirm" does with a checked batch. Nothing is saved on the site yet:
 * the rows go to the clipboard as TSV, for the Ledger tab of the guild sheet.
 * A later slice swaps this one function for "Save to ledger"; the page only
 * ever looks at the outcome.
 */
import type { ReviewedImage } from "@/modules/playground/batch";
import { buildTsv } from "@/modules/playground/export";
import { copyText } from "./clipboard";

export type SubmitOutcome =
  | { kind: "copied"; rows: number }
  /** The clipboard refused (a permission, an old browser): the rows are still there to copy by hand. */
  | { kind: "copy_failed"; rows: number };

export async function submitBatch(images: readonly ReviewedImage[]): Promise<SubmitOutcome> {
  const rows = images.reduce((sum, image) => sum + image.rows.length, 0);
  const copied = await copyText(buildTsv(images));
  return { kind: copied ? "copied" : "copy_failed", rows };
}
