/**
 * The `/try` page state: the upload queue plus the human review of every
 * finished read, behind one pure reducer. Queue actions run `queueReducer` and
 * then bring the reviews back in step (a finished read gets a review, a re-read
 * starts it over, a removed image loses it); review actions touch only reviews.
 *
 * A manual entry ("ready") gets a review too, with no extracted rows: every
 * row in it is one the member added, so totals, exports and the summary read
 * it exactly like a corrected AI read.
 */
import { queueReducer, initialQueueState, type QueueAction, type QueueEntry, type QueueFile, type QueueState } from "./queue";
import {
  correctedRows,
  initialReviewState,
  isReviewAction,
  reconcileReviews,
  reviewReducer,
  type ReviewAction,
  type ReviewSource,
  type ReviewState,
  type RowValues,
} from "./review";

export interface BatchState<F extends QueueFile = QueueFile> {
  queue: QueueState<F>;
  review: ReviewState;
}

export type BatchAction<F extends QueueFile = QueueFile> = QueueAction<F> | ReviewAction;

export function initialBatchState<F extends QueueFile = QueueFile>(): BatchState<F> {
  return { queue: initialQueueState<F>(), review: initialReviewState };
}

/** An entry whose rows can be reviewed: a finished read, or a manual entry. */
export function isReviewable(entry: QueueEntry): boolean {
  return entry.state === "ready" || (entry.state === "done" && !!entry.body);
}

/** Whether an entry holds deposit rows: a manual entry always, a read only when it looked like a bank log. */
export function holdsRows(entry: QueueEntry): boolean {
  if (entry.state === "ready") return true;
  return entry.state === "done" && !!entry.body && entry.body.result.looksLikeBankLog;
}

/** The entries a review exists for. A result that is not a bank log has no rows to review; a manual entry starts with none. */
export function reviewSources(entries: readonly QueueEntry[]): ReviewSource[] {
  return entries.flatMap((entry) =>
    isReviewable(entry)
      ? [
          {
            imageId: entry.id,
            token: entry.finishedAt ?? 0,
            rows: entry.state === "done" && entry.body?.result.looksLikeBankLog ? entry.body.result.rows : [],
          },
        ]
      : [],
  );
}

export function batchReducer<F extends QueueFile = QueueFile>(
  state: BatchState<F>,
  action: BatchAction<F>,
): BatchState<F> {
  if (isReviewAction(action)) {
    const review = reviewReducer(state.review, action);
    return review === state.review ? state : { ...state, review };
  }
  const queue = queueReducer(state.queue, action);
  if (queue === state.queue) return state;
  return { queue, review: reconcileReviews(state.review, reviewSources(queue.entries)) };
}

/** One image's corrected rows, for the summary strip and the exports. */
export interface ReviewedImage {
  imageId: string;
  fileName: string;
  looksLikeBankLog: boolean;
  /** Current values of the rows that count (deleted rows are out, added rows are in). */
  rows: RowValues[];
}

/** Every reviewable entry with its corrected rows, in list order. */
export function reviewedImages(entries: readonly QueueEntry[], review: ReviewState): ReviewedImage[] {
  return entries.flatMap((entry) =>
    isReviewable(entry)
      ? [
          {
            imageId: entry.id,
            fileName: entry.file.name,
            looksLikeBankLog: holdsRows(entry),
            rows: holdsRows(entry) ? correctedRows(review[entry.id]) : [],
          },
        ]
      : [],
  );
}

/** Every character name in the batch: the ones the extractor read and the ones typed into rows. */
export function knownCharacters(entries: readonly QueueEntry[], review: ReviewState): string[] {
  const names = new Set<string>();
  for (const entry of entries) {
    if (entry.state === "done" && entry.body) for (const name of entry.body.result.characters) names.add(name);
    for (const row of correctedRows(review[entry.id])) names.add(row.character);
  }
  names.delete("");
  return [...names];
}
