/**
 * The `/upload` page state behind one pure reducer: the upload queue, the human
 * review of every finished read, and the page's own affairs (the "By character"
 * filter, which image the check dialog shows, whether the batch was confirmed).
 * Queue actions run `queueReducer` and then bring the reviews back in step (a
 * finished read gets a review, a re-read starts it over, a removed image loses
 * it); review actions touch only reviews.
 *
 * The flow reads Upload → Check → Confirm (`uploadStep`): nothing finished yet,
 * rows waiting for a person (or the dialog open), every row checked.
 *
 * A manual entry ("ready") gets a review too, with no extracted rows: every
 * row in it is one the member added, so totals, exports and the summary read
 * it exactly like a corrected AI read.
 */
import { queueReducer, initialQueueState, type QueueAction, type QueueEntry, type QueueFile, type QueueState } from "./queue";
import {
  activeRows,
  batchReviewCounts,
  initialReviewState,
  isReviewAction,
  matchesCharacter,
  reconcileReviews,
  reviewCounts,
  reviewReducer,
  rowsInScope,
  type ReviewAction,
  type ReviewCounts,
  type ReviewSource,
  type ReviewState,
  type RowValues,
} from "./review";

export type UploadStep = "upload" | "check" | "confirm";

export const UPLOAD_STEPS: readonly UploadStep[] = ["upload", "check", "confirm"];

export interface BatchState<F extends QueueFile = QueueFile> {
  queue: QueueState<F>;
  review: ReviewState;
  /** "By character": only this character's rows are shown, counted and copied. null = every row; "" = rows without a name. */
  character: string | null;
  /** The image open in the check dialog, or null while it is closed. */
  checking: string | null;
  /** The dialog opened by itself for this round of reads; it will not again until more images join. */
  autoOpened: boolean;
  /** "Confirm" was pressed and nothing about the rows has changed since. */
  confirmed: boolean;
}

/** The page's own actions: nothing here touches the queue or the rows. */
export type PageAction =
  | { type: "filterCharacter"; character: string | null }
  | { type: "openCheck"; imageId: string }
  | { type: "closeCheck" }
  /** Only when the batch is at the Confirm step with rows to confirm. */
  | { type: "confirm" };

export type BatchAction<F extends QueueFile = QueueFile> = QueueAction<F> | ReviewAction | PageAction;

const PAGE_ACTION_TYPES: ReadonlySet<string> = new Set<PageAction["type"]>([
  "filterCharacter",
  "openCheck",
  "closeCheck",
  "confirm",
]);

function isPageAction(action: { type: string }): action is PageAction {
  return PAGE_ACTION_TYPES.has(action.type);
}

export function initialBatchState<F extends QueueFile = QueueFile>(): BatchState<F> {
  return {
    queue: initialQueueState<F>(),
    review: initialReviewState,
    character: null,
    checking: null,
    autoOpened: false,
    confirmed: false,
  };
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

/** The images the check dialog steps through (prev/next): every entry that holds rows, in list order. */
export function checkSequence(entries: readonly QueueEntry[]): string[] {
  return entries.filter(holdsRows).map((entry) => entry.id);
}

/** The first image (list order) with a row still waiting for a check, within the character filter. */
export function firstImageToCheck(
  entries: readonly QueueEntry[],
  review: ReviewState,
  character: string | null = null,
): string | null {
  for (const entry of entries) {
    if (holdsRows(entry) && reviewCounts(review[entry.id], character).toCheck > 0) return entry.id;
  }
  return null;
}

/** `reviewCounts` over the batch, within the character filter. */
export function batchCounts(entries: readonly QueueEntry[], review: ReviewState, character: string | null = null): ReviewCounts {
  return batchReviewCounts(
    entries.map((entry) => (holdsRows(entry) ? review[entry.id] : undefined)),
    character,
  );
}

function pending(entries: readonly QueueEntry[]): boolean {
  return entries.some((entry) => entry.state === "queued" || entry.state === "reading");
}

/**
 * Where the batch is: "upload" until an image has finished, "check" while a row
 * waits for a person (or the dialog is open, or reads are still in flight),
 * "confirm" once every row in scope is checked.
 */
export function uploadStep(state: BatchState): UploadStep {
  const { entries } = state.queue;
  if (!entries.some(isReviewable)) return "upload";
  if (state.checking !== null || pending(entries)) return "check";
  return batchCounts(entries, state.review, state.character).toCheck > 0 ? "check" : "confirm";
}

/** Whether "Confirm" can be pressed: at the Confirm step, with rows, and not already confirmed. */
export function canConfirm(state: BatchState): boolean {
  if (state.confirmed || uploadStep(state) !== "confirm") return false;
  return batchCounts(state.queue.entries, state.review, state.character).rows > 0;
}

/** Whether any row in the batch (filter aside) still belongs to the character. */
function characterExists(entries: readonly QueueEntry[], review: ReviewState, character: string): boolean {
  return entries.some(
    (entry) => holdsRows(entry) && activeRows(review[entry.id]).some((row) => matchesCharacter(row.current, character)),
  );
}

/** After a change: a filter with no rows left is dropped, a dialog on an image that left the batch closes. */
function tidy<F extends QueueFile>(state: BatchState<F>): BatchState<F> {
  let next = state;
  if (next.character !== null && !characterExists(next.queue.entries, next.review, next.character)) {
    next = { ...next, character: null };
  }
  if (next.checking !== null && !next.queue.entries.some((entry) => entry.id === next.checking && holdsRows(entry))) {
    next = { ...next, checking: null };
  }
  return next;
}

function pageReducer<F extends QueueFile>(state: BatchState<F>, action: PageAction): BatchState<F> {
  switch (action.type) {
    case "filterCharacter": {
      const character =
        action.character !== null && characterExists(state.queue.entries, state.review, action.character)
          ? action.character
          : null;
      return character === state.character ? state : tidy({ ...state, character });
    }
    case "openCheck": {
      const entry = state.queue.entries.find((candidate) => candidate.id === action.imageId);
      if (!entry || !holdsRows(entry) || state.checking === action.imageId) return state;
      return { ...state, checking: action.imageId };
    }
    case "closeCheck":
      return state.checking === null ? state : { ...state, checking: null };
    case "confirm":
      return canConfirm(state) ? { ...state, confirmed: true } : state;
  }
}

export function batchReducer<F extends QueueFile = QueueFile>(
  state: BatchState<F>,
  action: BatchAction<F>,
): BatchState<F> {
  if (isPageAction(action)) return pageReducer(state, action);

  if (isReviewAction(action)) {
    const review = reviewReducer(state.review, action);
    if (review === state.review) return state;
    // Any correction after "Confirm" takes the batch back to Check.
    return tidy({ ...state, review, confirmed: false });
  }

  const queue = queueReducer(state.queue, action);
  if (queue === state.queue) return state;
  const review = reconcileReviews(state.review, reviewSources(queue.entries));
  let next: BatchState<F> = { ...state, queue, review };
  if (queue.entries !== state.queue.entries) next.confirmed = false;
  // More images: a new round of reads, so the dialog may open by itself once more.
  if (action.type === "enqueue" || action.type === "clear") next.autoOpened = false;
  next = tidy(next);

  // The last read of the round is in: open the dialog on the first image that needs a look, once,
  // and never over the member's own doings (a dialog already open, or a round that opened it before).
  if ((action.type === "succeed" || action.type === "fail") && !next.autoOpened && next.checking === null && !pending(queue.entries)) {
    const first = firstImageToCheck(queue.entries, review, next.character);
    if (first !== null) next = { ...next, checking: first, autoOpened: true };
  }
  return next;
}

/** One image's corrected rows, for the summary strip and the exports. */
export interface ReviewedImage {
  imageId: string;
  fileName: string;
  looksLikeBankLog: boolean;
  /** Current values of the rows that count (deleted rows are out, added rows are in), within the character filter. */
  rows: RowValues[];
}

/** Every reviewable entry with its corrected rows, in list order; with `character`, only that character's rows. */
export function reviewedImages(
  entries: readonly QueueEntry[],
  review: ReviewState,
  character: string | null = null,
): ReviewedImage[] {
  return entries.flatMap((entry) =>
    isReviewable(entry)
      ? [
          {
            imageId: entry.id,
            fileName: entry.file.name,
            looksLikeBankLog: holdsRows(entry),
            rows: holdsRows(entry) ? rowsInScope(review[entry.id], character).map((row) => row.current) : [],
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
    for (const row of activeRows(review[entry.id])) names.add(row.current.character);
  }
  names.delete("");
  return [...names];
}
