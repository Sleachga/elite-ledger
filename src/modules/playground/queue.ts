/**
 * The `/try` upload queue as a pure reducer: many screenshots, one request
 * each, at most `QUEUE_CONCURRENCY` in flight. The React component only
 * dispatches actions and performs the fetches that `pickStartable` hands it.
 *
 * Browser-safe and side-effect free: no `Date.now()`, no object URLs, no ids
 * made here. The caller supplies them, so every transition is testable.
 */
import {
  errorText,
  validateImageFile,
  type PlaygroundErrorKind,
  type PlaygroundSuccessBody,
} from "./index";

/** Requests in flight at once. Two keeps a 20-image batch moving without tripping API limits. */
export const QUEUE_CONCURRENCY = 2;
/** Images a batch may hold; extra files are ignored with a message. */
export const MAX_BATCH_IMAGES = 20;
/** Vercel rejects request bodies above about 4.5 MB before they reach the app. */
export const HOST_BODY_LIMIT_BYTES = 4.5 * 1024 * 1024;

/** The parts of a `File` the queue looks at. A real `File` satisfies it. */
export interface QueueFile {
  name: string;
  size: number;
  type: string;
  lastModified: number;
}

export type EntryState = "queued" | "reading" | "done" | "failed" | "canceled";

export interface EntryError {
  kind: string;
  /** Server detail, when it adds something to the headline. */
  message?: string;
  /** From `Retry-After` on a 429. */
  retryAfterSeconds?: number;
  /** false when sending the same file again cannot work (wrong type, too large, playground off). */
  retryable: boolean;
}

export interface QueueEntry<F extends QueueFile = QueueFile> {
  id: string;
  file: F;
  /** Object URL for the thumbnail and preview; the component creates and revokes it. */
  previewUrl: string | null;
  state: EntryState;
  /** When the current read started (ms epoch). */
  startedAt?: number;
  /** When it reached `done` or `failed`. */
  finishedAt?: number;
  body?: PlaygroundSuccessBody;
  error?: EntryError;
}

export interface QueueState<F extends QueueFile = QueueFile> {
  entries: QueueEntry<F>[];
  /** No new reads start while true: a passcode is needed (first visit, or a 401). */
  paused: boolean;
}

export interface NewEntry<F extends QueueFile = QueueFile> {
  id: string;
  file: F;
  previewUrl: string | null;
}

export type QueueAction<F extends QueueFile = QueueFile> =
  | { type: "enqueue"; items: readonly NewEntry<F>[]; now: number }
  | { type: "start"; id: string; now: number }
  | { type: "succeed"; id: string; body: PlaygroundSuccessBody; now: number }
  | { type: "fail"; id: string; error: EntryError; now: number }
  /** A 401: the entry goes back in line and the queue waits for a passcode. */
  | { type: "unauthorized"; id: string }
  | { type: "retry"; id: string }
  | { type: "retryFailed" }
  | { type: "cancel"; id: string }
  | { type: "remove"; id: string }
  | { type: "clear" }
  | { type: "pause" }
  | { type: "resume" };

export function initialQueueState<F extends QueueFile = QueueFile>(): QueueState<F> {
  return { entries: [], paused: false };
}

const NOT_RETRYABLE: readonly string[] = ["bad_request", "too_large", "disabled"];

/** Whether sending the same file again could succeed. */
export function isRetryableKind(kind: string): boolean {
  return !NOT_RETRYABLE.includes(kind);
}

function canRetry(entry: QueueEntry): boolean {
  if (entry.state === "canceled") return true;
  return entry.state === "failed" && entry.error?.retryable !== false;
}

function requeued<F extends QueueFile>(entry: QueueEntry<F>): QueueEntry<F> {
  return { id: entry.id, file: entry.file, previewUrl: entry.previewUrl, state: "queued" };
}

function mapEntry<F extends QueueFile>(
  state: QueueState<F>,
  id: string,
  change: (entry: QueueEntry<F>) => QueueEntry<F>,
): QueueState<F> {
  let changed = false;
  const entries = state.entries.map((entry) => {
    if (entry.id !== id) return entry;
    const next = change(entry);
    if (next !== entry) changed = true;
    return next;
  });
  return changed ? { ...state, entries } : state;
}

export function queueReducer<F extends QueueFile = QueueFile>(
  state: QueueState<F>,
  action: QueueAction<F>,
): QueueState<F> {
  switch (action.type) {
    case "enqueue": {
      const known = new Set(state.entries.map((entry) => entry.id));
      const added: QueueEntry<F>[] = [];
      for (const item of action.items) {
        // The cap holds here too, whatever the caller planned.
        if (state.entries.length + added.length >= MAX_BATCH_IMAGES) break;
        if (known.has(item.id)) continue;
        known.add(item.id);
        const problem = validateImageFile(item.file);
        added.push(
          problem === null
            ? { ...item, state: "queued" }
            : {
                ...item,
                state: "failed",
                finishedAt: action.now,
                error: { kind: problem, retryable: false },
              },
        );
      }
      return added.length === 0 ? state : { ...state, entries: [...state.entries, ...added] };
    }

    case "start":
      return mapEntry(state, action.id, (entry) =>
        entry.state === "queued" ? { ...requeued(entry), state: "reading", startedAt: action.now } : entry,
      );

    case "succeed":
      // Anything but `reading` means the entry was canceled or re-queued meanwhile: a late answer is dropped.
      return mapEntry(state, action.id, (entry) =>
        entry.state === "reading"
          ? { ...entry, state: "done", body: action.body, error: undefined, finishedAt: action.now }
          : entry,
      );

    case "fail":
      return mapEntry(state, action.id, (entry) =>
        entry.state === "reading"
          ? { ...entry, state: "failed", error: action.error, body: undefined, finishedAt: action.now }
          : entry,
      );

    case "unauthorized": {
      const next = mapEntry(state, action.id, (entry) =>
        entry.state === "reading" ? requeued(entry) : entry,
      );
      return next.paused ? next : { ...next, paused: true };
    }

    case "retry":
      return mapEntry(state, action.id, (entry) => (canRetry(entry) ? requeued(entry) : entry));

    case "retryFailed": {
      if (!state.entries.some((entry) => entry.state === "failed" && canRetry(entry))) return state;
      return {
        ...state,
        entries: state.entries.map((entry) =>
          entry.state === "failed" && canRetry(entry) ? requeued(entry) : entry,
        ),
      };
    }

    case "cancel":
      return mapEntry(state, action.id, (entry) =>
        entry.state === "queued" || entry.state === "reading"
          ? { id: entry.id, file: entry.file, previewUrl: entry.previewUrl, state: "canceled" }
          : entry,
      );

    case "remove": {
      const entries = state.entries.filter((entry) => entry.id !== action.id);
      return entries.length === state.entries.length ? state : { ...state, entries };
    }

    case "clear":
      return state.entries.length === 0 ? state : { ...state, entries: [] };

    case "pause":
      return state.paused ? state : { ...state, paused: true };

    case "resume":
      return state.paused ? { ...state, paused: false } : state;
  }
}

/**
 * The queued entries to start now, in list order: never more than the free
 * slots (`limit` minus the reads in flight), and none while paused.
 */
export function pickStartable<F extends QueueFile>(
  state: QueueState<F>,
  limit: number = QUEUE_CONCURRENCY,
): QueueEntry<F>[] {
  if (state.paused) return [];
  const reading = state.entries.filter((entry) => entry.state === "reading").length;
  const free = Math.max(0, limit - reading);
  if (free === 0) return [];
  return state.entries.filter((entry) => entry.state === "queued").slice(0, free);
}

/** Ids whose request is in flight: what "Clear all" has to abort. */
export function readingIds(state: QueueState): string[] {
  return state.entries.filter((entry) => entry.state === "reading").map((entry) => entry.id);
}

export function hasRetryableFailures(state: QueueState): boolean {
  return state.entries.some((entry) => entry.state === "failed" && canRetry(entry));
}

export function canRetryEntry(entry: QueueEntry): boolean {
  return canRetry(entry);
}

/**
 * Which entry to show when the user has not picked one: the first that
 * finished reading, else the first in the list.
 */
export function autoSelectId(entries: readonly QueueEntry[]): string | null {
  let first: QueueEntry | null = null;
  for (const entry of entries) {
    if (entry.state !== "done" || entry.finishedAt === undefined) continue;
    if (first === null || entry.finishedAt < (first.finishedAt ?? Infinity)) first = entry;
  }
  return first?.id ?? entries[0]?.id ?? null;
}

/**
 * The selected entry id. `picked` is the user's own choice: once made (and as
 * long as that entry exists) it wins, so a finishing read never steals the
 * selection. `null` = the user closed everything (phones); `undefined` = no
 * choice yet.
 */
export function resolveSelection(
  entries: readonly QueueEntry[],
  picked: string | null | undefined,
): string | null {
  if (picked === null) return null;
  if (picked !== undefined && entries.some((entry) => entry.id === picked)) return picked;
  return autoSelectId(entries);
}

/** Same name + size + lastModified = the same file, as far as a batch cares. */
export function fileFingerprint(file: QueueFile): string {
  return `${file.size}:${file.lastModified}:${file.name}`;
}

export interface BatchPlan<F extends QueueFile = QueueFile> {
  accepted: F[];
  /** Exact duplicates of a file already in the batch (or earlier in this drop). */
  duplicates: number;
  /** Files left out because the batch is full. */
  overCap: number;
}

/** Decide which incoming files join the batch: duplicates go first, then the cap. */
export function planBatch<F extends QueueFile>(
  existing: readonly QueueFile[],
  incoming: readonly F[],
  max: number = MAX_BATCH_IMAGES,
): BatchPlan<F> {
  const seen = new Set(existing.map(fileFingerprint));
  const accepted: F[] = [];
  let duplicates = 0;
  let overCap = 0;
  for (const file of incoming) {
    const fingerprint = fileFingerprint(file);
    if (seen.has(fingerprint)) {
      duplicates += 1;
    } else if (existing.length + accepted.length >= max) {
      overCap += 1;
    } else {
      seen.add(fingerprint);
      accepted.push(file);
    }
  }
  return { accepted, duplicates, overCap };
}

export interface BatchNotes {
  /** Files ignored because the batch is full. */
  cap: string | null;
  duplicates: string | null;
}

export function batchNotes(plan: Pick<BatchPlan, "duplicates" | "overCap">, max: number = MAX_BATCH_IMAGES): BatchNotes {
  const files = (count: number) => (count === 1 ? "1 file" : `${count} files`);
  return {
    cap:
      plan.overCap > 0
        ? `${files(plan.overCap)} ignored: a batch holds up to ${max} images. Remove some or clear the list to add more.`
        : null,
    duplicates:
      plan.duplicates > 0
        ? `${plan.duplicates === 1 ? "1 duplicate" : `${plan.duplicates} duplicates`} skipped (already in the list).`
        : null,
  };
}

/** Over the host's body cap: the read will most likely come back as a 413. */
export function exceedsHostLimit(size: number): boolean {
  return size > HOST_BODY_LIMIT_BYTES;
}

/** `Retry-After` as whole seconds: delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null | undefined, now: number): number | undefined {
  const value = header?.trim();
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - now) / 1000));
}

function isSuccessBody(body: unknown): body is PlaygroundSuccessBody {
  return typeof body === "object" && body !== null && "result" in body && "durationMs" in body;
}

function errorBodyOf(body: unknown): { kind: string; message?: string } | null {
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  if (typeof error !== "object" || error === null || !("kind" in error)) return null;
  const { kind, message } = error as { kind: unknown; message?: unknown };
  if (typeof kind !== "string") return null;
  return { kind, message: typeof message === "string" ? message : undefined };
}

export type RequestOutcome =
  | { type: "success"; body: PlaygroundSuccessBody }
  | { type: "unauthorized" }
  | { type: "failure"; error: EntryError };

const HOST_413 =
  "The host rejected the upload before it reached the app. Vercel caps request bodies at about 4.5 MB; crop the screenshot or save it as JPEG.";

/** What one `POST /api/try-extract` answer means for its entry. `body` is the parsed JSON, or null. */
export function interpretResponse(
  status: number,
  body: unknown,
  retryAfterHeader: string | null,
  now: number,
): RequestOutcome {
  if (status >= 200 && status < 300 && isSuccessBody(body)) return { type: "success", body };

  const retryAfterSeconds = status === 429 ? parseRetryAfter(retryAfterHeader, now) : undefined;
  const error = errorBodyOf(body);
  if (error) {
    if (error.kind === "unauthorized") return { type: "unauthorized" };
    return {
      type: "failure",
      error: {
        kind: error.kind,
        message: error.message,
        retryable: isRetryableKind(error.kind),
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      },
    };
  }

  // No JSON error body: the host answered instead of the app.
  if (status === 401) return { type: "unauthorized" };
  if (status === 413) {
    return { type: "failure", error: { kind: "too_large", message: HOST_413, retryable: false } };
  }
  if (status === 429) {
    return {
      type: "failure",
      error: {
        kind: "too_many_requests",
        retryable: true,
        ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
      },
    };
  }
  return {
    type: "failure",
    error: {
      kind: status === 504 ? "network" : "api",
      message: `The server answered with HTTP ${status}.`,
      retryable: true,
    },
  };
}

/** 42 -> "42 s", 480 -> "8 min". */
export function formatWait(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  return whole < 90 ? `${whole} s` : `${Math.ceil(whole / 60)} min`;
}

const BUSY_KINDS: readonly string[] = ["rate_limit", "too_many_requests"] satisfies PlaygroundErrorKind[];

/** Headline for a failed entry. A 429 reads "Busy", with the wait when the server gave one. */
export function failureText(error: Pick<EntryError, "kind" | "retryAfterSeconds">): string {
  if (BUSY_KINDS.includes(error.kind)) {
    return error.retryAfterSeconds !== undefined
      ? `Busy — retry in ${formatWait(error.retryAfterSeconds)}.`
      : "Busy — retry in a minute.";
  }
  return errorText(error.kind);
}
