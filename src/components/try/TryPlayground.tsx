"use client";

import { useEffect, useEffectEvent, useMemo, useReducer, useRef, useState } from "react";
import { Box, Button, Callout, Card, Flex, Grid, Heading, SegmentedControl, Text, TextField } from "@radix-ui/themes";
import { NavIcon } from "@/components/shell/NavIcons";
import {
  ACCEPTED_MEDIA_TYPES,
  IMAGE_FIELD,
  PASSCODE_HEADER,
  TRY_EXTRACT_ENDPOINT,
  errorText,
  type PlaygroundStatusBody,
} from "@/modules/playground";
import { batchReducer, initialBatchState, knownCharacters } from "@/modules/playground/batch";
import {
  MODE_LABEL,
  UPLOAD_MODE_STORAGE_KEY,
  aiAvailable,
  availableModes,
  isUploadMode,
  modeStatusOf,
  resolveMode,
  singleModeNote,
  type UploadMode,
} from "@/modules/playground/mode";
import {
  BLANK_ENTRY_NAME,
  MAX_BATCH_IMAGES,
  QUEUE_CONCURRENCY,
  batchNotes,
  blankEntryId,
  hasRetryableFailures,
  imageEntries,
  interpretResponse,
  pickStartable,
  planBatch,
  resolveSelection,
  type BatchNotes,
  type NewEntry,
  type QueueEntry,
} from "@/modules/playground/queue";
import { EntryCards, EntryDetail, EntryRail, type EntryActions, type ReviewContext } from "./TryEntries";
import { TrySummary } from "./TrySummary";
import { DESKTOP_QUERY, useMediaQuery } from "./hooks";
import styles from "./TryPlayground.module.css";

const PASSCODE_STORAGE_KEY = "elite-ledger:try-passcode";

function readStoredPasscode(): string {
  try {
    return window.sessionStorage.getItem(PASSCODE_STORAGE_KEY) ?? "";
  } catch {
    return ""; // storage blocked: the field simply shows again next time
  }
}

function storePasscode(value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(PASSCODE_STORAGE_KEY);
    else window.sessionStorage.setItem(PASSCODE_STORAGE_KEY, value);
  } catch {
    // ignore
  }
}

/** The member's own choice of mode, kept per browser. Storage may be blocked: then the admin's default applies. */
function readStoredMode(): UploadMode | null {
  try {
    const value = window.localStorage.getItem(UPLOAD_MODE_STORAGE_KEY);
    return isUploadMode(value) ? value : null;
  } catch {
    return null;
  }
}

function storeMode(mode: UploadMode): void {
  try {
    window.localStorage.setItem(UPLOAD_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore
  }
}

const MODE_HINT: Record<UploadMode, string> = {
  manual: "You add the rows by hand. Nothing is sent anywhere.",
  ai: "Claude reads each screenshot; you check and correct the rows.",
};

/** Every file of a drop. A file that is not an image still gets its (failed) line in the list. */
function droppedFiles(data: DataTransfer | null): File[] {
  return data ? Array.from(data.files) : [];
}

/** Every image of a paste; a paste may carry more than one. Text pastes give none. */
function pastedImages(data: DataTransfer | null): File[] {
  if (!data) return [];
  const fromFiles = Array.from(data.files).filter((file) => file.type.startsWith("image/"));
  if (fromFiles.length > 0) return fromFiles;
  const images: File[] = [];
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  return images;
}

export function TryPlayground() {
  const [status, setStatus] = useState<PlaygroundStatusBody | null>(null);
  /** The status call has answered (or failed): only then is it known which modes are on offer. */
  const [statusSettled, setStatusSettled] = useState(false);
  /** The member's own choice of mode (remembered per browser); null = none, the admin's default applies. */
  const [chosenMode, setChosenMode] = useState<UploadMode | null>(null);
  const [passcode, setPasscode] = useState("");
  const [passcodeRejected, setPasscodeRejected] = useState(false);
  // The upload queue and the human review of every finished read, behind one reducer.
  const [{ queue, review }, dispatch] = useReducer(batchReducer<File>, undefined, initialBatchState<File>);
  const [notes, setNotes] = useState<BatchNotes>({ cap: null, duplicates: null });
  const [dragOver, setDragOver] = useState(false);
  /** The user's own choice of entry: undefined = none yet, null = closed everything (cards). */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  const controllers = useRef(new Map<string, AbortController>());
  const liveUrls = useRef(new Set<string>());
  const nextId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Rail + detail from 1024px, stacked cards below. Phones first: the server renders the cards.
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const { entries, paused } = queue;
  /** Every character name read or typed so far, offered while entering one. */
  const characters = useMemo(() => knownCharacters(entries, review), [entries, review]);
  const context: ReviewContext = { review, dispatch, characters };
  // A failed status call reads as today's behaviour; the first POST then says what is wrong.
  const modeStatus = modeStatusOf(status);
  const canUseAi = aiAvailable(modeStatus);
  const modes = availableModes(modeStatus);
  const mode = resolveMode(modeStatus, chosenMode);
  const modeNote = singleModeNote(modeStatus);

  // Ask the server whether a passcode is needed; reuse one from this tab's session.
  useEffect(() => {
    const controller = new AbortController();
    fetch(TRY_EXTRACT_ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<PlaygroundStatusBody>)
      .then((body) => {
        setStatus(body);
        setChosenMode(readStoredMode());
        setStatusSettled(true);
        if (!body.passcodeRequired) return;
        const stored = readStoredPasscode();
        if (stored !== "") setPasscode(stored);
        else dispatch({ type: "pause" }); // nothing is sent until a passcode is entered
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        // Unknown status: the first POST will say what is wrong.
        setChosenMode(readStoredMode());
        setStatusSettled(true);
      });
    return () => controller.abort();
  }, []);

  // Free the object URLs of entries that left the list (remove, clear all).
  useEffect(() => {
    const current = new Set(entries.flatMap((entry) => (entry.previewUrl ? [entry.previewUrl] : [])));
    for (const url of liveUrls.current) {
      if (!current.has(url)) URL.revokeObjectURL(url);
    }
    liveUrls.current = current;
  }, [entries]);

  // Leaving the page: stop every request and free every preview.
  useEffect(() => {
    const inFlight = controllers.current;
    const urls = liveUrls;
    return () => {
      for (const controller of inFlight.values()) controller.abort();
      inFlight.clear();
      for (const url of urls.current) URL.revokeObjectURL(url);
      urls.current = new Set();
    };
  }, []);

  /** One request for one image. The reducer ignores the answer if the entry moved on meanwhile. */
  async function read(entry: QueueEntry<File>, code: string) {
    const controller = new AbortController();
    controllers.current.set(entry.id, controller);
    const release = () => {
      if (controllers.current.get(entry.id) === controller) controllers.current.delete(entry.id);
    };
    dispatch({ type: "start", id: entry.id, now: Date.now() });

    const form = new FormData();
    form.append(IMAGE_FIELD, entry.file, entry.file.name || "screenshot");
    const headers: Record<string, string> = {};
    // Header values must be printable ASCII; anything else cannot be the passcode.
    if (code !== "" && /^[\x20-\x7e]+$/.test(code)) headers[PASSCODE_HEADER] = code;

    let response: Response;
    try {
      response = await fetch(TRY_EXTRACT_ENDPOINT, {
        method: "POST",
        body: form,
        headers,
        signal: controller.signal,
      });
    } catch {
      release();
      if (controller.signal.aborted) return;
      dispatch({
        type: "fail",
        id: entry.id,
        now: Date.now(),
        error: {
          kind: "unreachable",
          message: "Could not reach the server. Check your connection and try again.",
          retryable: true,
        },
      });
      return;
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // Not JSON: the host answered instead of the app (a 413, for one).
    }
    release();
    if (controller.signal.aborted) return;

    const outcome = interpretResponse(response.status, body, response.headers.get("Retry-After"), Date.now());
    if (outcome.type === "success") {
      if (code !== "") {
        storePasscode(code);
        setPasscodeRejected(false);
      }
      dispatch({ type: "succeed", id: entry.id, body: outcome.body, now: Date.now() });
    } else if (outcome.type === "unauthorized") {
      // Back in line; the queue waits until a passcode is entered.
      storePasscode(null);
      setPasscodeRejected(code !== "");
      setStatus((current) => ({ ...modeStatusOf(current), passcodeRequired: true }));
      dispatch({ type: "unauthorized", id: entry.id });
    } else if (outcome.type === "ai_disabled") {
      // An admin switched AI reading off under the batch: the page goes manual, and
      // everything still waiting becomes a manual entry instead of failing one by one.
      setStatus((current) => ({
        ...modeStatusOf(current),
        passcodeRequired: current?.passcodeRequired ?? false,
        aiEnabled: false,
      }));
      for (const other of controllers.current.values()) other.abort();
      controllers.current.clear();
      dispatch({ type: "toManual", now: Date.now() });
    } else {
      dispatch({ type: "fail", id: entry.id, error: outcome.error, now: Date.now() });
    }
  }

  // The queue runner: after every change, start whatever the reducer's picker hands over.
  const pump = useEffectEvent(() => {
    // Never before the modes are known, and never while AI reading is off.
    if (!statusSettled || !canUseAi) return;
    for (const entry of pickStartable(queue, QUEUE_CONCURRENCY)) {
      if (controllers.current.has(entry.id)) continue;
      void read(entry, passcode.trim());
    }
  });

  useEffect(() => {
    pump();
  }, [queue, statusSettled, canUseAi]);

  function abort(id: string) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
  }

  function addFiles(files: File[]) {
    if (!statusSettled || files.length === 0) return;
    const plan = planBatch(
      imageEntries(entries).map((entry) => entry.file),
      files,
      MAX_BATCH_IMAGES,
    );
    setNotes(batchNotes(plan, MAX_BATCH_IMAGES));
    if (plan.accepted.length === 0) return;

    const items: NewEntry<File>[] = plan.accepted.map((file) => {
      nextId.current += 1;
      // Anything the browser calls an image gets a preview, even one the reducer will refuse.
      const previewUrl = file.type.startsWith("image/") && file.size > 0 ? URL.createObjectURL(file) : null;
      if (previewUrl) liveUrls.current.add(previewUrl);
      return { id: `shot-${nextId.current}`, file, previewUrl };
    });
    // The mode at the moment of the drop decides what these images become; entries already in the
    // batch keep their kind.
    const entryMode = resolveMode(modeStatusOf(status), chosenMode);
    dispatch({ type: "enqueue", items, now: Date.now(), mode: entryMode });
    // A manual image is there to be typed from: show it straight away.
    if (entryMode === "manual") setPicked(items[0].id);
  }

  /** The one manual entry without a screenshot: make it, or go to it. */
  function addBlankEntry() {
    const existing = blankEntryId(entries);
    if (existing) {
      setPicked(existing);
      return;
    }
    nextId.current += 1;
    const id = `manual-${nextId.current}`;
    dispatch({ type: "addBlank", item: { id, file: new File([], BLANK_ENTRY_NAME), previewUrl: null }, now: Date.now() });
    setPicked(id);
  }

  function chooseMode(value: string) {
    if (!isUploadMode(value)) return;
    setChosenMode(value);
    storeMode(value);
  }

  function clearAll() {
    for (const controller of controllers.current.values()) controller.abort();
    controllers.current.clear();
    dispatch({ type: "clear" });
    setNotes({ cap: null, duplicates: null });
    setPicked(undefined);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const actions: EntryActions = {
    onRetry: (id) => dispatch({ type: "retry", id }),
    onCancel: (id) => {
      abort(id);
      dispatch({ type: "cancel", id });
    },
    onRemove: (id) => {
      abort(id);
      dispatch({ type: "remove", id });
    },
    onManual: (id) => {
      abort(id);
      dispatch({ type: "toManual", id, now: Date.now() });
    },
  };

  // Win+Shift+S then Ctrl+V. Text pastes (the passcode field) are left alone.
  const onPaste = useEffectEvent((event: ClipboardEvent) => {
    const images = pastedImages(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    addFiles(images);
  });

  useEffect(() => {
    const listener = (event: ClipboardEvent) => onPaste(event);
    window.addEventListener("paste", listener);
    return () => window.removeEventListener("paste", listener);
  }, []);

  const hasEntries = entries.length > 0;
  // Desktop always shows an entry; on phones a card opens by itself only once it has a result.
  const selectedId = resolveSelection(entries, isDesktop && picked === null ? undefined : picked, isDesktop);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const waiting = entries.filter((entry) => entry.state === "queued").length;
  const images = imageEntries(entries).length;
  const full = images >= MAX_BATCH_IMAGES;
  const dropDisabled = !statusSettled || full;

  // Manual mode never calls the server, so it never asks for the passcode (unless reads are still waiting for one).
  const passcodeForm = paused && canUseAi && (mode === "ai" || waiting > 0) && (
    <Card size="2">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (passcode.trim() === "") return;
          setPasscodeRejected(false);
          dispatch({ type: "resume" });
        }}
      >
        <Flex direction="column" gap="2">
          <Text as="label" size="2" weight="medium" htmlFor="try-passcode">
            Passcode
          </Text>
          <Flex gap="2" align="center" wrap="wrap">
            <Box flexGrow="1" minWidth="160px" maxWidth="320px">
              <TextField.Root
                id="try-passcode"
                type="password"
                autoComplete="off"
                placeholder="Ask Sandy"
                value={passcode}
                color={passcodeRejected ? "red" : undefined}
                aria-invalid={passcodeRejected || undefined}
                aria-describedby="try-passcode-help"
                onChange={(event) => setPasscode(event.target.value)}
              />
            </Box>
            <Button type="submit" disabled={passcode.trim() === ""}>
              {waiting === 0 ? "Continue" : waiting === 1 ? "Read screenshot" : `Read ${waiting} screenshots`}
            </Button>
          </Flex>
          {passcodeRejected && (
            <Text size="2" color="red" role="alert">
              {errorText("unauthorized")}
              {waiting > 0 ? " The remaining screenshots are waiting." : ""}
            </Text>
          )}
          <Text id="try-passcode-help" size="1" color="gray">
            Each read spends API credits, so the playground is passcode-gated. It is remembered
            until you close this tab.
          </Text>
        </Flex>
      </form>
    </Card>
  );

  const dropzone = (
    <label
      className={styles.dropzone}
      data-compact={hasEntries}
      data-drag-over={dragOver}
      data-disabled={dropDisabled}
    >
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        multiple
        accept={ACCEPTED_MEDIA_TYPES.join(",")}
        disabled={dropDisabled}
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          // So the same file can be chosen again after it was removed.
          event.target.value = "";
        }}
      />
      <NavIcon
        name="upload"
        width={hasEntries ? 20 : 28}
        height={hasEntries ? 20 : 28}
        style={{ color: "var(--accent-11)", flexShrink: 0 }}
      />
      {hasEntries ? (
        <Text size="2" weight="medium">
          {full ? `Batch full (${MAX_BATCH_IMAGES} images)` : "Add more screenshots"}
        </Text>
      ) : (
        <>
          <Text size="3" weight="medium">
            <Box as="span" display={{ initial: "none", sm: "inline" }}>
              Drop bank-log screenshots, paste with Ctrl+V, or click to choose
            </Box>
            <Box as="span" display={{ initial: "inline", sm: "none" }}>
              Tap to choose bank-log screenshots
            </Box>
          </Text>
          <Text size="2" color="gray">
            PNG, JPEG or WebP · up to 10 MB each · up to {MAX_BATCH_IMAGES} at once ·{" "}
            {mode === "manual" ? "kept in your browser to type the rows from" : "10–20 seconds per image"}
          </Text>
        </>
      )}
    </label>
  );

  const modeBar = (
    // Holds its height while the status call is out, so nothing jumps when the control arrives.
    <Flex align="center" gap="3" wrap="wrap" minHeight="32px">
      {statusSettled && modes.length > 1 && (
        <>
          <SegmentedControl.Root size="2" value={mode} onValueChange={chooseMode} aria-label="How rows get in">
            {modes.map((value) => (
              <SegmentedControl.Item key={value} value={value}>
                {MODE_LABEL[value]}
              </SegmentedControl.Item>
            ))}
          </SegmentedControl.Root>
          <Text size="2" color="gray" aria-live="polite">
            {MODE_HINT[mode]}
          </Text>
        </>
      )}
      {statusSettled && modeNote && (
        <Text size="2" color="gray" role="status">
          {modeNote}
        </Text>
      )}
    </Flex>
  );

  const blankButton = statusSettled && mode === "manual" && (
    <Flex>
      <Button size="1" variant="soft" color="gray" onClick={addBlankEntry}>
        {blankEntryId(entries) ? "Go to the entry without a screenshot" : "Add rows without a screenshot"}
      </Button>
    </Flex>
  );

  const batchNotice = (notes.cap || notes.duplicates) && (
    <Flex direction="column" gap="2">
      {notes.cap && (
        <Callout.Root color="amber" size="1" role="status">
          <Callout.Text>{notes.cap}</Callout.Text>
        </Callout.Root>
      )}
      {notes.duplicates && (
        <Text size="1" color="gray" role="status">
          {notes.duplicates}
        </Text>
      )}
    </Flex>
  );

  const batchBar = hasEntries && (
    <Flex align="center" justify="between" gap="3" wrap="wrap">
      <Heading as="h2" size="3">
        {images === entries.length
          ? `${images} ${images === 1 ? "screenshot" : "screenshots"}`
          : `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`}
      </Heading>
      <Flex gap="2" wrap="wrap">
        {hasRetryableFailures(queue) && (
          <Button size="1" variant="soft" onClick={() => dispatch({ type: "retryFailed" })}>
            Retry failed
          </Button>
        )}
        <Button size="1" variant="soft" color="gray" onClick={clearAll}>
          Clear all
        </Button>
      </Flex>
    </Flex>
  );

  return (
    <Flex
      direction="column"
      gap="4"
      onDragOver={(event) => {
        if (!Array.from(event.dataTransfer.types).includes("Files")) return;
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        addFiles(droppedFiles(event.dataTransfer));
      }}
    >
      {modeBar}

      {passcodeForm}

      {!hasEntries && (
        <>
          {dropzone}
          {blankButton}
          {batchNotice}
        </>
      )}

      {hasEntries && <TrySummary entries={entries} review={review} />}

      {hasEntries && isDesktop && (
        <Grid columns="232px minmax(0, 1fr)" gap="4" align="start">
          <Flex direction="column" gap="3" className={styles.rail}>
            {dropzone}
            {blankButton}
            {batchNotice}
            {batchBar}
            <EntryRail
              entries={entries}
              review={review}
              selectedId={selectedId}
              onSelect={(id) => setPicked(id)}
              onRemove={actions.onRemove}
            />
          </Flex>
          {/* Keyed so the rows stagger in again, and the row link starts clean, for a different image. */}
          {selected && (
            <EntryDetail key={selected.id} entry={selected} paused={paused} actions={actions} context={context} />
          )}
        </Grid>
      )}

      {hasEntries && !isDesktop && (
        <>
          {dropzone}
          {blankButton}
          {batchNotice}
          {batchBar}
          <EntryCards
            entries={entries}
            openId={selectedId}
            paused={paused}
            onToggle={(id) => setPicked(id === selectedId ? null : id)}
            actions={actions}
            context={context}
          />
        </>
      )}
    </Flex>
  );
}
