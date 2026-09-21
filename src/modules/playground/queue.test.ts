import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, type PlaygroundSuccessBody } from "./index";
import {
  HOST_BODY_LIMIT_BYTES,
  MAX_BATCH_IMAGES,
  QUEUE_CONCURRENCY,
  autoSelectId,
  batchNotes,
  canRetryEntry,
  exceedsHostLimit,
  failureText,
  fileFingerprint,
  formatWait,
  hasRetryableFailures,
  initialQueueState,
  interpretResponse,
  isRetryableKind,
  parseRetryAfter,
  pickStartable,
  planBatch,
  queueReducer,
  readingIds,
  resolveSelection,
  type NewEntry,
  type QueueAction,
  type QueueFile,
  type QueueState,
} from "./queue";

function file(name: string, overrides: Partial<QueueFile> = {}): QueueFile {
  return { name, size: 1000, type: "image/png", lastModified: 1_700_000_000_000, ...overrides };
}

function item(id: string, overrides: Partial<QueueFile> = {}): NewEntry {
  return { id, file: file(`${id}.png`, overrides), previewUrl: `blob:${id}` };
}

const BODY: PlaygroundSuccessBody = {
  result: {
    looksLikeBankLog: true,
    rows: [],
    characters: [],
    warnings: [],
    model: "claude-opus-5",
    usage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 },
  },
  durationMs: 1234,
};

function run(actions: QueueAction[], from: QueueState = initialQueueState()): QueueState {
  return actions.reduce(queueReducer, from);
}

function queueOf(...ids: string[]): QueueState {
  return run([{ type: "enqueue", items: ids.map((id) => item(id)), now: 1 }]);
}

function states(state: QueueState): Record<string, string> {
  return Object.fromEntries(state.entries.map((entry) => [entry.id, entry.state]));
}

const RETRYABLE_ERROR = { kind: "api", message: "boom", retryable: true } as const;

describe("queueReducer: enqueue", () => {
  it("appends valid files as queued, in order", () => {
    const state = queueOf("a", "b", "c");
    expect(state.entries.map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(states(state)).toEqual({ a: "queued", b: "queued", c: "queued" });
    expect(state.entries[0].previewUrl).toBe("blob:a");
    expect(state.paused).toBe(false);
  });

  it("turns a bad file into a failed, non-retryable entry without blocking the others", () => {
    const state = run([
      {
        type: "enqueue",
        now: 50,
        items: [
          item("gif", { type: "image/gif" }),
          item("ok"),
          item("huge", { size: MAX_IMAGE_BYTES + 1 }),
          item("empty", { size: 0 }),
        ],
      },
    ]);
    expect(states(state)).toEqual({ gif: "failed", ok: "queued", huge: "failed", empty: "failed" });
    expect(state.entries[0].error).toEqual({ kind: "bad_request", retryable: false });
    expect(state.entries[2].error).toEqual({ kind: "too_large", retryable: false });
    expect(state.entries[0].finishedAt).toBe(50);
    expect(pickStartable(state).map((entry) => entry.id)).toEqual(["ok"]);
  });

  it("can add more while others are reading", () => {
    const state = run(
      [
        { type: "start", id: "a", now: 2 },
        { type: "enqueue", items: [item("c")], now: 3 },
      ],
      queueOf("a", "b"),
    );
    expect(states(state)).toEqual({ a: "reading", b: "queued", c: "queued" });
  });

  it("never holds more than the cap, and ignores an id it already has", () => {
    const many = Array.from({ length: MAX_BATCH_IMAGES + 5 }, (_, index) => item(`f${index}`));
    const full = run([{ type: "enqueue", items: many, now: 1 }]);
    expect(full.entries).toHaveLength(MAX_BATCH_IMAGES);
    expect(queueReducer(full, { type: "enqueue", items: [item("late")], now: 2 })).toBe(full);

    const state = queueOf("a");
    expect(queueReducer(state, { type: "enqueue", items: [item("a")], now: 2 })).toBe(state);
  });
});

describe("queueReducer: start / succeed / fail", () => {
  it("queued -> reading -> done", () => {
    let state = queueReducer(queueOf("a"), { type: "start", id: "a", now: 10 });
    expect(state.entries[0]).toMatchObject({ state: "reading", startedAt: 10 });
    state = queueReducer(state, { type: "succeed", id: "a", body: BODY, now: 20 });
    expect(state.entries[0]).toMatchObject({ state: "done", body: BODY, finishedAt: 20 });
    expect(state.entries[0].error).toBeUndefined();
  });

  it("queued -> reading -> failed", () => {
    const state = run(
      [
        { type: "start", id: "a", now: 10 },
        { type: "fail", id: "a", error: RETRYABLE_ERROR, now: 30 },
      ],
      queueOf("a"),
    );
    expect(state.entries[0]).toMatchObject({ state: "failed", error: RETRYABLE_ERROR, finishedAt: 30 });
  });

  it("only starts a queued entry", () => {
    const done = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "succeed", id: "a", body: BODY, now: 2 },
      ],
      queueOf("a"),
    );
    expect(queueReducer(done, { type: "start", id: "a", now: 3 })).toBe(done);
    expect(queueReducer(done, { type: "start", id: "nope", now: 3 })).toBe(done);
  });

  it("drops a late answer for an entry that is no longer reading", () => {
    const queued = queueOf("a");
    expect(queueReducer(queued, { type: "succeed", id: "a", body: BODY, now: 5 })).toBe(queued);
    expect(queueReducer(queued, { type: "fail", id: "a", error: RETRYABLE_ERROR, now: 5 })).toBe(queued);

    const canceled = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "cancel", id: "a" },
      ],
      queued,
    );
    expect(queueReducer(canceled, { type: "succeed", id: "a", body: BODY, now: 5 })).toBe(canceled);

    const removed = run([{ type: "start", id: "a", now: 1 }, { type: "remove", id: "a" }], queued);
    expect(queueReducer(removed, { type: "succeed", id: "a", body: BODY, now: 5 })).toBe(removed);
  });
});

describe("queueReducer: retry, retryFailed, cancel", () => {
  const mixed = run(
    [
      { type: "start", id: "a", now: 1 },
      { type: "start", id: "b", now: 1 },
      { type: "fail", id: "a", error: RETRYABLE_ERROR, now: 2 },
      { type: "succeed", id: "b", body: BODY, now: 2 },
      { type: "start", id: "c", now: 3 },
      { type: "fail", id: "c", error: { kind: "rate_limit", retryable: true, retryAfterSeconds: 30 }, now: 4 },
      { type: "enqueue", items: [item("bad", { type: "text/plain" })], now: 5 },
    ],
    queueOf("a", "b", "c", "d"),
  );

  it("retry re-queues a failed entry and clears its error", () => {
    const state = queueReducer(mixed, { type: "retry", id: "a" });
    expect(state.entries[0]).toEqual({ id: "a", file: file("a.png"), previewUrl: "blob:a", state: "queued" });
  });

  it("retry leaves done, queued and non-retryable entries alone", () => {
    expect(queueReducer(mixed, { type: "retry", id: "b" })).toBe(mixed);
    expect(queueReducer(mixed, { type: "retry", id: "d" })).toBe(mixed);
    expect(queueReducer(mixed, { type: "retry", id: "bad" })).toBe(mixed);
    expect(canRetryEntry(mixed.entries[4])).toBe(false);
  });

  it("retryFailed re-queues every retryable failure and nothing else", () => {
    expect(hasRetryableFailures(mixed)).toBe(true);
    const state = queueReducer(mixed, { type: "retryFailed" });
    expect(states(state)).toEqual({ a: "queued", b: "done", c: "queued", d: "queued", bad: "failed" });
    expect(hasRetryableFailures(state)).toBe(false);
    expect(queueReducer(state, { type: "retryFailed" })).toBe(state);
  });

  it("cancel stops a queued or reading entry; a canceled entry can be retried", () => {
    let state = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "cancel", id: "a" },
        { type: "cancel", id: "b" },
      ],
      queueOf("a", "b", "c"),
    );
    expect(states(state)).toEqual({ a: "canceled", b: "canceled", c: "queued" });
    expect(state.entries[0].startedAt).toBeUndefined();
    expect(pickStartable(state).map((entry) => entry.id)).toEqual(["c"]);

    state = queueReducer(state, { type: "retry", id: "a" });
    expect(states(state).a).toBe("queued");
    // retryFailed is about failures, not cancellations.
    expect(states(queueReducer(state, { type: "retryFailed" })).b).toBe("canceled");
  });

  it("cancel leaves finished entries alone", () => {
    expect(queueReducer(mixed, { type: "cancel", id: "b" })).toBe(mixed);
    expect(queueReducer(mixed, { type: "cancel", id: "a" })).toBe(mixed);
  });
});

describe("queueReducer: remove and clear", () => {
  it("removes an in-flight entry and frees its slot", () => {
    let state = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "start", id: "b", now: 1 },
      ],
      queueOf("a", "b", "c", "d"),
    );
    expect(pickStartable(state)).toEqual([]);
    expect(readingIds(state)).toEqual(["a", "b"]);

    state = queueReducer(state, { type: "remove", id: "a" });
    expect(state.entries.map((entry) => entry.id)).toEqual(["b", "c", "d"]);
    expect(pickStartable(state).map((entry) => entry.id)).toEqual(["c"]);
    expect(queueReducer(state, { type: "remove", id: "a" })).toBe(state);
  });

  it("clear empties the batch mid-flight and keeps the pause flag", () => {
    const busy = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "unauthorized", id: "a" },
        { type: "resume" },
        { type: "start", id: "a", now: 2 },
      ],
      queueOf("a", "b"),
    );
    const cleared = queueReducer(busy, { type: "clear" });
    expect(cleared).toEqual({ entries: [], paused: false });
    // The answer to an aborted request changes nothing.
    expect(queueReducer(cleared, { type: "succeed", id: "a", body: BODY, now: 9 })).toBe(cleared);
    expect(queueReducer(cleared, { type: "clear" })).toBe(cleared);

    const paused = queueReducer(queueReducer(queueOf("a"), { type: "pause" }), { type: "clear" });
    expect(paused).toEqual({ entries: [], paused: true });
  });
});

describe("queueReducer: 401 pause and resume", () => {
  it("a 401 puts the entry back in line and pauses the queue", () => {
    let state = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "start", id: "b", now: 1 },
        { type: "unauthorized", id: "a" },
      ],
      queueOf("a", "b", "c"),
    );
    expect(state.paused).toBe(true);
    expect(states(state)).toEqual({ a: "queued", b: "reading", c: "queued" });
    expect(state.entries[0].startedAt).toBeUndefined();
    expect(pickStartable(state)).toEqual([]);

    // The second in-flight request comes back 401 as well.
    state = queueReducer(state, { type: "unauthorized", id: "b" });
    expect(states(state)).toEqual({ a: "queued", b: "queued", c: "queued" });
    expect(state.paused).toBe(true);
  });

  it("resume picks the remaining entries up again, in order", () => {
    const paused = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "unauthorized", id: "a" },
      ],
      queueOf("a", "b", "c"),
    );
    const resumed = queueReducer(paused, { type: "resume" });
    expect(resumed.paused).toBe(false);
    expect(pickStartable(resumed).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(queueReducer(resumed, { type: "resume" })).toBe(resumed);
  });

  it("pause holds a fresh batch until resume; files can still be added", () => {
    let state = queueReducer(initialQueueState(), { type: "pause" });
    expect(queueReducer(state, { type: "pause" })).toBe(state);
    state = queueReducer(state, { type: "enqueue", items: [item("a"), item("b")], now: 1 });
    expect(pickStartable(state)).toEqual([]);
    expect(pickStartable(queueReducer(state, { type: "resume" }))).toHaveLength(2);
  });

  it("a reading entry that finishes while paused still lands", () => {
    const state = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "start", id: "b", now: 1 },
        { type: "unauthorized", id: "a" },
        { type: "succeed", id: "b", body: BODY, now: 5 },
      ],
      queueOf("a", "b"),
    );
    expect(states(state)).toEqual({ a: "queued", b: "done" });
    expect(state.paused).toBe(true);
  });
});

describe("pickStartable", () => {
  it("fills the free slots in list order", () => {
    const state = queueOf("a", "b", "c");
    expect(pickStartable(state).map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(pickStartable(state, 1).map((entry) => entry.id)).toEqual(["a"]);
    expect(pickStartable(state, 0)).toEqual([]);
    const one = queueReducer(state, { type: "start", id: "a", now: 1 });
    expect(pickStartable(one).map((entry) => entry.id)).toEqual(["b"]);
  });

  it("never lets more than two read at once, whatever happens to the batch", () => {
    // A deterministic pseudo-random walk over every kind of action.
    let seed = 42;
    const random = (max: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % max;
    };

    let state: QueueState = initialQueueState();
    let nextId = 0;
    let maxReading = 0;
    let started = 0;

    for (let step = 0; step < 3000; step += 1) {
      // What the component does after every change: start what the picker hands over.
      for (const entry of pickStartable(state)) {
        state = queueReducer(state, { type: "start", id: entry.id, now: step });
        started += 1;
      }
      const reading = readingIds(state);
      maxReading = Math.max(maxReading, reading.length);
      expect(reading.length).toBeLessThanOrEqual(QUEUE_CONCURRENCY);

      const ids = state.entries.map((entry) => entry.id);
      const anyId = ids.length > 0 ? ids[random(ids.length)] : "none";
      const readingId = reading.length > 0 ? reading[random(reading.length)] : "none";
      const actions: QueueAction[] = [
        { type: "enqueue", items: [item(`n${(nextId += 1)}`), item(`n${(nextId += 1)}`)], now: step },
        { type: "succeed", id: readingId, body: BODY, now: step },
        { type: "succeed", id: readingId, body: BODY, now: step },
        { type: "fail", id: readingId, error: RETRYABLE_ERROR, now: step },
        { type: "unauthorized", id: readingId },
        { type: "resume" },
        { type: "resume" },
        { type: "retry", id: anyId },
        { type: "retryFailed" },
        { type: "cancel", id: anyId },
        { type: "remove", id: anyId },
        { type: "pause" },
        ...(random(40) === 0 ? [{ type: "clear" } as const] : []),
      ];
      state = queueReducer(state, actions[random(actions.length)]);
      expect(state.entries.length).toBeLessThanOrEqual(MAX_BATCH_IMAGES);
    }

    expect(maxReading).toBe(QUEUE_CONCURRENCY);
    expect(started).toBeGreaterThan(100);
  });
});

describe("selection", () => {
  const finished = run(
    [
      { type: "start", id: "a", now: 1 },
      { type: "start", id: "b", now: 1 },
      { type: "succeed", id: "b", body: BODY, now: 10 },
      { type: "succeed", id: "a", body: BODY, now: 20 },
    ],
    queueOf("a", "b", "c"),
  );

  it("auto-selects the first entry that finished, else the first in the list", () => {
    expect(autoSelectId([])).toBeNull();
    expect(autoSelectId(queueOf("a", "b").entries)).toBe("a");
    expect(autoSelectId(finished.entries)).toBe("b");
  });

  it("a failure does not count as finished reading", () => {
    const state = run(
      [
        { type: "start", id: "a", now: 1 },
        { type: "start", id: "b", now: 1 },
        { type: "fail", id: "a", error: RETRYABLE_ERROR, now: 5 },
        { type: "succeed", id: "b", body: BODY, now: 9 },
      ],
      queueOf("a", "b"),
    );
    expect(autoSelectId(state.entries)).toBe("b");
  });

  it("never steals the selection once the user has picked", () => {
    expect(resolveSelection(finished.entries, undefined)).toBe("b");
    expect(resolveSelection(finished.entries, "c")).toBe("c");
    expect(resolveSelection(finished.entries, null)).toBeNull();
  });

  it("falls back to the automatic choice when the picked entry is gone", () => {
    const state = queueReducer(finished, { type: "remove", id: "c" });
    expect(resolveSelection(state.entries, "c")).toBe("b");
  });
});

describe("planBatch and duplicates", () => {
  it("fingerprints on name + size + lastModified", () => {
    expect(fileFingerprint(file("a.png"))).toBe(fileFingerprint(file("a.png", { type: "image/jpeg" })));
    expect(fileFingerprint(file("a.png"))).not.toBe(fileFingerprint(file("b.png")));
    expect(fileFingerprint(file("a.png"))).not.toBe(fileFingerprint(file("a.png", { size: 1001 })));
    expect(fileFingerprint(file("a.png"))).not.toBe(fileFingerprint(file("a.png", { lastModified: 1 })));
  });

  it("skips exact duplicates of the batch and of the same drop", () => {
    const plan = planBatch([file("a.png")], [file("a.png"), file("b.png"), file("b.png"), file("c.png")]);
    expect(plan.accepted.map((entry) => entry.name)).toEqual(["b.png", "c.png"]);
    expect(plan.duplicates).toBe(2);
    expect(plan.overCap).toBe(0);
  });

  it("two pastes share a name but not a timestamp, so both stay", () => {
    const plan = planBatch(
      [file("image.png", { lastModified: 1 })],
      [file("image.png", { lastModified: 2 })],
    );
    expect(plan.accepted).toHaveLength(1);
    expect(plan.duplicates).toBe(0);
  });

  it("caps the batch at 20 and counts what was left out", () => {
    const existing = Array.from({ length: 18 }, (_, index) => file(`old${index}.png`));
    const incoming = Array.from({ length: 5 }, (_, index) => file(`new${index}.png`));
    const plan = planBatch(existing, incoming);
    expect(plan.accepted.map((entry) => entry.name)).toEqual(["new0.png", "new1.png"]);
    expect(plan.overCap).toBe(3);
  });

  it("a duplicate does not use up a slot", () => {
    const existing = Array.from({ length: 19 }, (_, index) => file(`old${index}.png`));
    const plan = planBatch(existing, [file("old0.png"), file("new.png"), file("extra.png")]);
    expect(plan).toMatchObject({ duplicates: 1, overCap: 1 });
    expect(plan.accepted.map((entry) => entry.name)).toEqual(["new.png"]);
  });

  it("words the notes", () => {
    expect(batchNotes({ duplicates: 0, overCap: 0 })).toEqual({ cap: null, duplicates: null });
    const notes = batchNotes({ duplicates: 1, overCap: 3 });
    expect(notes.cap).toBe(
      "3 files ignored: a batch holds up to 20 images. Remove some or clear the list to add more.",
    );
    expect(notes.duplicates).toBe("1 duplicate skipped (already in the list).");
    expect(batchNotes({ duplicates: 2, overCap: 1 })).toEqual({
      cap: "1 file ignored: a batch holds up to 20 images. Remove some or clear the list to add more.",
      duplicates: "2 duplicates skipped (already in the list).",
    });
  });
});

describe("host limit", () => {
  it("warns above 4.5 MB only", () => {
    expect(exceedsHostLimit(HOST_BODY_LIMIT_BYTES)).toBe(false);
    expect(exceedsHostLimit(HOST_BODY_LIMIT_BYTES + 1)).toBe(true);
    expect(HOST_BODY_LIMIT_BYTES).toBeLessThan(MAX_IMAGE_BYTES);
  });
});

describe("interpretResponse", () => {
  const NOW = Date.parse("2026-09-20T12:00:00Z");

  it("200 with a result is a success", () => {
    expect(interpretResponse(200, BODY, null, NOW)).toEqual({ type: "success", body: BODY });
  });

  it("401 is 'unauthorized', with or without a JSON body", () => {
    const body = { error: { kind: "unauthorized", message: "Wrong or missing passcode." } };
    expect(interpretResponse(401, body, null, NOW)).toEqual({ type: "unauthorized" });
    expect(interpretResponse(401, null, null, NOW)).toEqual({ type: "unauthorized" });
  });

  it("429 carries the wait from Retry-After", () => {
    const body = { error: { kind: "too_many_requests", message: "Too many requests." } };
    expect(interpretResponse(429, body, "42", NOW)).toEqual({
      type: "failure",
      error: { kind: "too_many_requests", message: "Too many requests.", retryable: true, retryAfterSeconds: 42 },
    });
    expect(interpretResponse(429, { error: { kind: "rate_limit", message: "slow" } }, null, NOW)).toEqual({
      type: "failure",
      error: { kind: "rate_limit", message: "slow", retryable: true },
    });
    expect(interpretResponse(429, null, "7", NOW)).toEqual({
      type: "failure",
      error: { kind: "too_many_requests", retryable: true, retryAfterSeconds: 7 },
    });
  });

  it("marks errors a retry cannot fix", () => {
    const outcome = interpretResponse(400, { error: { kind: "bad_request", message: "nope" } }, null, NOW);
    expect(outcome).toEqual({
      type: "failure",
      error: { kind: "bad_request", message: "nope", retryable: false },
    });
    expect(isRetryableKind("too_large")).toBe(false);
    expect(isRetryableKind("disabled")).toBe(false);
    expect(isRetryableKind("network")).toBe(true);
  });

  it("explains a host 413 and other bodiless answers", () => {
    const tooLarge = interpretResponse(413, null, null, NOW);
    expect(tooLarge).toMatchObject({ type: "failure", error: { kind: "too_large", retryable: false } });
    expect(interpretResponse(504, null, null, NOW)).toMatchObject({
      type: "failure",
      error: { kind: "network", retryable: true },
    });
    expect(interpretResponse(500, "<html>", null, NOW)).toMatchObject({
      type: "failure",
      error: { kind: "api", message: "The server answered with HTTP 500." },
    });
    // A 200 that is not a result is not a success.
    expect(interpretResponse(200, {}, null, NOW).type).toBe("failure");
  });
});

describe("Retry-After and failure text", () => {
  const NOW = Date.parse("2026-09-20T12:00:00Z");

  it("parses seconds and HTTP dates", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120);
    expect(parseRetryAfter(" 5 ", NOW)).toBe(5);
    expect(parseRetryAfter("Sun, 20 Sep 2026 12:01:30 GMT", NOW)).toBe(90);
    expect(parseRetryAfter("Sun, 20 Sep 2026 11:00:00 GMT", NOW)).toBe(0);
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter("", NOW)).toBeUndefined();
    expect(parseRetryAfter("soon", NOW)).toBeUndefined();
  });

  it("formats the wait", () => {
    expect(formatWait(0)).toBe("1 s");
    expect(formatWait(42)).toBe("42 s");
    expect(formatWait(88.2)).toBe("89 s");
    expect(formatWait(90)).toBe("2 min");
    expect(formatWait(480)).toBe("8 min");
  });

  it("a 429 reads 'busy', with the wait when there is one", () => {
    expect(failureText({ kind: "too_many_requests" })).toBe("Busy — retry in a minute.");
    expect(failureText({ kind: "rate_limit" })).toBe("Busy — retry in a minute.");
    expect(failureText({ kind: "too_many_requests", retryAfterSeconds: 42 })).toBe("Busy — retry in 42 s.");
    expect(failureText({ kind: "rate_limit", retryAfterSeconds: 300 })).toBe("Busy — retry in 5 min.");
  });

  it("other kinds keep the playground wording", () => {
    expect(failureText({ kind: "too_large" })).toBe("That image is too large. The limit is 10 MB.");
    expect(failureText({ kind: "???" })).toBe("Something went wrong. Try again.");
  });
});
