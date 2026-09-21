"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card, Flex, Grid, IconButton, Progress, Spinner, Text } from "@radix-ui/themes";
import {
  canRetryEntry,
  exceedsHostLimit,
  failureText,
  type EntryState,
  type QueueEntry,
} from "@/modules/playground/queue";
import { lowConfidenceCount, worstFlag } from "@/modules/playground/summary";
import { TryResult } from "./TryResult";
import styles from "./TryPlayground.module.css";

export interface EntryActions {
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function displayName(entry: QueueEntry): string {
  return entry.file.name || "Pasted image";
}

const STATE_LABEL: Record<EntryState, string> = {
  queued: "Queued",
  reading: "Reading",
  done: "Done",
  failed: "Failed",
  canceled: "Canceled",
};

const STATE_COLOR: Record<EntryState, "gray" | "amber" | "green" | "red"> = {
  queued: "gray",
  reading: "amber",
  done: "green",
  failed: "red",
  canceled: "gray",
};

function StateBadge({ entry }: { entry: QueueEntry }) {
  if (entry.state === "done" && entry.body && !entry.body.result.looksLikeBankLog) {
    return (
      <Badge color="amber" variant="soft" size="1">
        Not a bank log
      </Badge>
    );
  }
  return (
    <Badge color={STATE_COLOR[entry.state]} variant={entry.state === "canceled" ? "outline" : "soft"} size="1">
      {entry.state === "reading" && <Spinner size="1" />}
      {STATE_LABEL[entry.state]}
    </Badge>
  );
}

function rowsOf(entry: QueueEntry) {
  if (entry.state !== "done" || !entry.body || !entry.body.result.looksLikeBankLog) return null;
  return entry.body.result.rows;
}

function Thumb({ entry }: { entry: QueueEntry }) {
  if (!entry.previewUrl) {
    return (
      <span className={styles.thumb} data-empty="true" aria-hidden>
        ?
      </span>
    );
  }
  // A blob: preview of the user's own file; next/image has nothing to optimise.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={styles.thumb} src={entry.previewUrl} alt="" />;
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

/** One line per image: thumbnail, name, state, row count, low-confidence dot, remove. */
function EntryHeader({
  entry,
  selected,
  mode,
  controls,
  onSelect,
  onRemove,
}: {
  entry: QueueEntry;
  selected: boolean;
  /** "rail": picks the entry shown on the right. "card": opens and closes the card. */
  mode: "rail" | "card";
  controls?: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const rows = rowsOf(entry);
  const flag = rows ? worstFlag(rows) : null;
  const flagged = rows ? lowConfidenceCount(rows) : 0;

  return (
    <div className={styles.entryHeader} data-selected={selected} data-mode={mode}>
      <button
        type="button"
        className={styles.entrySelect}
        onClick={onSelect}
        {...(mode === "rail"
          ? { "aria-current": selected ? ("true" as const) : undefined }
          : { "aria-expanded": selected, "aria-controls": controls })}
      >
        <Thumb entry={entry} />
        <span className={styles.entryText}>
          <Text as="span" size="2" weight="medium" truncate className={styles.entryName} title={displayName(entry)}>
            {displayName(entry)}
          </Text>
          <span className={styles.entryMeta}>
            <StateBadge entry={entry} />
            {entry.state !== "done" && exceedsHostLimit(entry.file.size) && (
              <Badge
                color="amber"
                variant="outline"
                size="1"
                title="Over 4.5 MB: the host will most likely reject this upload"
              >
                Over 4.5 MB
              </Badge>
            )}
            {rows && (
              <Text as="span" size="1" color="gray" className={styles.numeric}>
                {rows.length} {rows.length === 1 ? "row" : "rows"}
              </Text>
            )}
            {flag && (
              <span
                className={styles.flagDot}
                data-level={flag}
                role="img"
                aria-label={`${flagged} to double-check`}
                title={`${flagged} ${flagged === 1 ? "row" : "rows"} to double-check`}
              />
            )}
          </span>
        </span>
        {mode === "card" && (
          <span className={styles.chevron}>
            <Chevron open={selected} />
          </span>
        )}
      </button>
      <IconButton
        size={mode === "card" ? "2" : "1"}
        variant="ghost"
        color="gray"
        aria-label={`Remove ${displayName(entry)}`}
        title="Remove"
        onClick={onRemove}
      >
        <CloseIcon />
      </IconButton>
    </div>
  );
}

function Reading({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    }, 500);
    return () => window.clearInterval(id);
  }, [startedAt]);

  return (
    <Card size="2" role="status" aria-live="polite">
      <Flex direction="column" gap="3">
        <Flex align="center" justify="between" gap="3">
          <Flex align="center" gap="2">
            <Spinner size="2" />
            <Text size="3" weight="medium">
              Reading…
            </Text>
          </Flex>
          <Text size="2" color="gray" className={styles.numeric}>
            {elapsed} s
          </Text>
        </Flex>
        {/* No value = indeterminate; Radix fills it over `duration`, then holds. */}
        <Progress size="1" duration="20s" aria-label="Reading the screenshot" />
        <Text size="2" color="gray">
          Claude is reading the screenshot row by row. This usually takes 10–20 seconds.
        </Text>
      </Flex>
    </Card>
  );
}

function EntryBody({ entry, paused, actions }: { entry: QueueEntry; paused: boolean; actions: EntryActions }) {
  const { error } = entry;
  const headline = error ? failureText(error) : "";
  const pending = entry.state === "queued" || entry.state === "reading";

  return (
    <Flex direction="column" gap="4" minWidth="0">
      {entry.state !== "done" && exceedsHostLimit(entry.file.size) && entry.error?.kind !== "too_large" && (
        <Callout.Root color="amber" size="1">
          <Callout.Text>
            {formatBytes(entry.file.size)}: the host rejects uploads over about 4.5 MB. Crop the screenshot or
            save it as JPEG if this read fails.
          </Callout.Text>
        </Callout.Root>
      )}

      {entry.state === "queued" && (
        <Text size="2" color="gray" role="status">
          {paused ? "Waiting for the passcode." : "Queued. Two screenshots are read at a time."}
        </Text>
      )}

      {entry.state === "reading" && <Reading key={entry.startedAt} startedAt={entry.startedAt ?? 0} />}

      {entry.state === "canceled" && (
        <Text size="2" color="gray" role="status">
          Canceled before it was read.
        </Text>
      )}

      {entry.state === "failed" && error && (
        <Callout.Root color="red" role="alert">
          <Callout.Text weight="medium">{headline}</Callout.Text>
          {error.message && error.message !== headline && (
            <Callout.Text size="1" style={{ overflowWrap: "anywhere" }}>
              {error.message}
            </Callout.Text>
          )}
        </Callout.Root>
      )}

      {entry.state === "done" && entry.body && (
        <TryResult result={entry.body.result} durationMs={entry.body.durationMs} />
      )}

      <Flex gap="3" wrap="wrap">
        {canRetryEntry(entry) && (
          <Button size="2" variant="soft" onClick={() => actions.onRetry(entry.id)}>
            Retry
          </Button>
        )}
        {pending && (
          <Button size="2" variant="soft" color="gray" onClick={() => actions.onCancel(entry.id)}>
            Cancel
          </Button>
        )}
        <Button size="2" variant="soft" color="gray" onClick={() => actions.onRemove(entry.id)}>
          Remove
        </Button>
      </Flex>
    </Flex>
  );
}

function Screenshot({ entry, sticky }: { entry: QueueEntry; sticky: boolean }) {
  return (
    <Flex direction="column" gap="2" className={sticky ? styles.shot : styles.shotStacked}>
      {entry.previewUrl ? (
        <a href={entry.previewUrl} target="_blank" rel="noreferrer" title="Open full size in a new tab">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.shotImage} src={entry.previewUrl} alt={`Screenshot ${displayName(entry)}`} />
        </a>
      ) : (
        <Text size="2" color="gray">
          No preview for this file.
        </Text>
      )}
      <Text size="1" color="gray" truncate>
        {displayName(entry)} · {formatBytes(entry.file.size)}
      </Text>
    </Flex>
  );
}

/** Desktop: the image list on the left. */
export function EntryRail({
  entries,
  selectedId,
  onSelect,
  onRemove,
}: {
  entries: readonly QueueEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <ul className={styles.entryList} aria-label="Screenshots">
      {entries.map((entry) => (
        <li key={entry.id}>
          <EntryHeader
            entry={entry}
            mode="rail"
            selected={entry.id === selectedId}
            onSelect={() => onSelect(entry.id)}
            onRemove={() => onRemove(entry.id)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Desktop: the selected image, screenshot beside its parsed rows. */
export function EntryDetail({
  entry,
  paused,
  actions,
}: {
  entry: QueueEntry;
  paused: boolean;
  actions: EntryActions;
}) {
  return (
    // The rows table needs about 540px; the screenshot takes the rest and opens full size on click.
    <Grid columns="minmax(0, 1fr) minmax(0, 1.9fr)" gap="4" align="start">
      <Screenshot entry={entry} sticky />
      {/* Keyed so the rows stagger in again for a different image. */}
      <EntryBody key={entry.id} entry={entry} paused={paused} actions={actions} />
    </Grid>
  );
}

/** Phones and tablets: one collapsible card per image. */
export function EntryCards({
  entries,
  openId,
  paused,
  onToggle,
  actions,
}: {
  entries: readonly QueueEntry[];
  openId: string | null;
  paused: boolean;
  onToggle: (id: string) => void;
  actions: EntryActions;
}) {
  return (
    <ul className={styles.entryList} aria-label="Screenshots">
      {entries.map((entry) => {
        const open = entry.id === openId;
        const panelId = `try-entry-${entry.id}`;
        return (
          <li key={entry.id}>
            <Card size="1" className={styles.entryCard}>
              <EntryHeader
                entry={entry}
                mode="card"
                selected={open}
                controls={panelId}
                onSelect={() => onToggle(entry.id)}
                onRemove={() => actions.onRemove(entry.id)}
              />
              {open && (
                <Flex id={panelId} direction="column" gap="4" pt="3" minWidth="0">
                  <Screenshot entry={entry} sticky={false} />
                  <EntryBody entry={entry} paused={paused} actions={actions} />
                </Flex>
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
