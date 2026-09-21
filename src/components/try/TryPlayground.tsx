"use client";

import { useEffect, useEffectEvent, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { Box, Button, Callout, Card, Flex, Grid, Heading, Text, TextField } from "@radix-ui/themes";
import { NavIcon } from "@/components/shell/NavIcons";
import {
  ACCEPTED_MEDIA_TYPES,
  IMAGE_FIELD,
  PASSCODE_HEADER,
  TRY_EXTRACT_ENDPOINT,
  errorText,
  type PlaygroundStatusBody,
} from "@/modules/playground";
import {
  MAX_BATCH_IMAGES,
  QUEUE_CONCURRENCY,
  batchNotes,
  hasRetryableFailures,
  initialQueueState,
  interpretResponse,
  pickStartable,
  planBatch,
  queueReducer,
  resolveSelection,
  type BatchNotes,
  type NewEntry,
  type QueueEntry,
} from "@/modules/playground/queue";
import { EntryCards, EntryDetail, EntryRail, type EntryActions } from "./TryEntries";
import { TrySummary } from "./TrySummary";
import styles from "./TryPlayground.module.css";

const PASSCODE_STORAGE_KEY = "elite-ledger:try-passcode";
const DESKTOP_QUERY = "(min-width: 1024px)";

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

function subscribeToDesktop(onChange: () => void): () => void {
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Rail + detail from 1024px, stacked cards below. Phones first: the server renders the cards. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeToDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

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
  const [passcode, setPasscode] = useState("");
  const [passcodeRejected, setPasscodeRejected] = useState(false);
  const [queue, dispatch] = useReducer(queueReducer<File>, undefined, initialQueueState<File>);
  const [notes, setNotes] = useState<BatchNotes>({ cap: null, duplicates: null });
  const [dragOver, setDragOver] = useState(false);
  /** The user's own choice of entry: undefined = none yet, null = closed everything (cards). */
  const [picked, setPicked] = useState<string | null | undefined>(undefined);

  const controllers = useRef(new Map<string, AbortController>());
  const liveUrls = useRef(new Set<string>());
  const nextId = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isDesktop = useIsDesktop();

  const { entries, paused } = queue;
  const disabled = status !== null && !status.enabled;

  // Ask the server whether a passcode is needed; reuse one from this tab's session.
  useEffect(() => {
    const controller = new AbortController();
    fetch(TRY_EXTRACT_ENDPOINT, { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json() as Promise<PlaygroundStatusBody>)
      .then((body) => {
        setStatus(body);
        if (!body.passcodeRequired) return;
        const stored = readStoredPasscode();
        if (stored !== "") setPasscode(stored);
        else dispatch({ type: "pause" }); // nothing is sent until a passcode is entered
      })
      .catch(() => {
        // Unknown status: the first POST will say what is wrong.
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
      setStatus((current) => ({ enabled: current?.enabled ?? true, passcodeRequired: true }));
      dispatch({ type: "unauthorized", id: entry.id });
    } else {
      dispatch({ type: "fail", id: entry.id, error: outcome.error, now: Date.now() });
    }
  }

  // The queue runner: after every change, start whatever the reducer's picker hands over.
  const pump = useEffectEvent(() => {
    if (disabled) return;
    for (const entry of pickStartable(queue, QUEUE_CONCURRENCY)) {
      if (controllers.current.has(entry.id)) continue;
      void read(entry, passcode.trim());
    }
  });

  useEffect(() => {
    pump();
  }, [queue, disabled]);

  function abort(id: string) {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
  }

  function addFiles(files: File[]) {
    if (disabled || files.length === 0) return;
    const plan = planBatch(
      entries.map((entry) => entry.file),
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
    dispatch({ type: "enqueue", items, now: Date.now() });
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
  const full = entries.length >= MAX_BATCH_IMAGES;

  const passcodeForm = paused && !disabled && (
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
      data-disabled={disabled || full}
    >
      <input
        ref={fileInputRef}
        className={styles.fileInput}
        type="file"
        multiple
        accept={ACCEPTED_MEDIA_TYPES.join(",")}
        disabled={disabled || full}
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
            PNG, JPEG or WebP · up to 10 MB each · up to {MAX_BATCH_IMAGES} at once · 10–20 seconds per image
          </Text>
        </>
      )}
    </label>
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
        {entries.length} {entries.length === 1 ? "screenshot" : "screenshots"}
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
      {disabled && (
        <Callout.Root color="red">
          <Callout.Text>
            {errorText("disabled")} The server has no <code>TRY_PASSCODE</code> set.
          </Callout.Text>
        </Callout.Root>
      )}

      {passcodeForm}

      {!hasEntries && (
        <>
          {dropzone}
          {batchNotice}
        </>
      )}

      {hasEntries && <TrySummary entries={entries} />}

      {hasEntries && isDesktop && (
        <Grid columns="232px minmax(0, 1fr)" gap="4" align="start">
          <Flex direction="column" gap="3" className={styles.rail}>
            {dropzone}
            {batchNotice}
            {batchBar}
            <EntryRail
              entries={entries}
              selectedId={selectedId}
              onSelect={(id) => setPicked(id)}
              onRemove={actions.onRemove}
            />
          </Flex>
          {selected && <EntryDetail entry={selected} paused={paused} actions={actions} />}
        </Grid>
      )}

      {hasEntries && !isDesktop && (
        <>
          {dropzone}
          {batchNotice}
          {batchBar}
          <EntryCards
            entries={entries}
            openId={selectedId}
            paused={paused}
            onToggle={(id) => setPicked(id === selectedId ? null : id)}
            actions={actions}
          />
        </>
      )}
    </Flex>
  );
}
