/**
 * The `/try` page state: the upload queue plus the human review of every
 * finished read, behind one pure reducer. Queue actions run `queueReducer` and
 * then bring the reviews back in step (a finished read gets a review, a re-read
 * starts it over, a removed image loses it); review actions touch only reviews.
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

/** The finished reads a review exists for. A result that is not a bank log has no rows to review. */
export function reviewSources(entries: readonly QueueEntry[]): ReviewSource[] {
  return entries.flatMap((entry) =>
    entry.state === "done" && entry.body
      ? [
          {
            imageId: entry.id,
            token: entry.finishedAt ?? 0,
            rows: entry.body.result.looksLikeBankLog ? entry.body.result.rows : [],
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

/** Every finished image with its corrected rows, in list order. */
export function reviewedImages(entries: readonly QueueEntry[], review: ReviewState): ReviewedImage[] {
  return entries.flatMap((entry) =>
    entry.state === "done" && entry.body
      ? [
          {
            imageId: entry.id,
            fileName: entry.file.name,
            looksLikeBankLog: entry.body.result.looksLikeBankLog,
            rows: entry.body.result.looksLikeBankLog ? correctedRows(review[entry.id]) : [],
          },
        ]
      : [],
  );
}
