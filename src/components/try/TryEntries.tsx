"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import { Badge, Button, Callout, Card, Flex, Grid, IconButton, Progress, Spinner, Text } from "@radix-ui/themes";
import { buildFixture, fixtureFileName, fixtureJson } from "@/modules/playground/export";
import { rowAtFraction } from "@/modules/playground/geometry";
import {
  canRetryEntry,
  exceedsHostLimit,
  failureText,
  type EntryState,
  type QueueEntry,
} from "@/modules/playground/queue";
import {
  activeRows,
  correctedRows,
  reviewCounts,
  type ImageReview,
  type ReviewAction,
  type ReviewState,
} from "@/modules/playground/review";
import { BESIDE_QUERY, useImageSize, useMediaQuery } from "./hooks";
import type { RowSelection } from "./ReviewRows";
import { ToCheckBadge, TryResult } from "./TryResult";
import reviewStyles from "./Review.module.css";
import styles from "./TryPlayground.module.css";

export interface EntryActions {
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}

/** What every entry view needs to show and change the human review. */
export interface ReviewContext {
  review: ReviewState;
  dispatch: (action: ReviewAction) => void;
  /** Character names read anywhere in the batch. */
  characters: readonly string[];
}

/** Hand the browser a file made on the spot. Nothing leaves the page. */
function downloadText(fileName: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

function isBankLog(entry: QueueEntry): boolean {
  return entry.state === "done" && !!entry.body && entry.body.result.looksLikeBankLog;
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

/** One line per image: thumbnail, name, state, row count, what is left to check, remove. */
function EntryHeader({
  entry,
  review,
  selected,
  mode,
  controls,
  onSelect,
  onRemove,
}: {
  entry: QueueEntry;
  review: ImageReview | undefined;
  selected: boolean;
  /** "rail": picks the entry shown on the right. "card": opens and closes the card. */
  mode: "rail" | "card";
  controls?: string;
  onSelect: () => void;
  onRemove: () => void;
}) {
  const counts = isBankLog(entry) ? reviewCounts(review) : null;

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
            {counts && (
              <Text as="span" size="1" color="gray" className={styles.numeric}>
                {counts.rows} {counts.rows === 1 ? "row" : "rows"}
              </Text>
            )}
            {counts && <ToCheckBadge rows={counts.rows} toCheck={counts.toCheck} />}
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


/** The row ↔ screenshot link of one entry: which row is lit, and which one was picked on the image. */
interface RowLink {
  activeRowId: string | null;
  /** Where the lit row was pointed at: on the rows, or on the screenshot itself. */
  activeFrom: "rows" | "shot";
  setActiveRow: (rowId: string | null, from: "rows" | "shot") => void;
  selection: RowSelection | null;
  selectRow: (rowId: string) => void;
}

function useRowLink(): RowLink {
  const [active, setActive] = useState<{ rowId: string | null; from: "rows" | "shot" }>({
    rowId: null,
    from: "rows",
  });
  const [selection, setSelection] = useState<RowSelection | null>(null);
  return {
    activeRowId: active.rowId,
    activeFrom: active.from,
    setActiveRow: (rowId, from) =>
      setActive((current) => (current.rowId === rowId && current.from === from ? current : { rowId, from })),
    selection,
    selectRow: (rowId) => setSelection((current) => ({ rowId, nonce: (current?.nonce ?? 0) + 1 })),
  };
}

function EntryBody({
  entry,
  paused,
  actions,
  context,
  link,
}: {
  entry: QueueEntry;
  paused: boolean;
  actions: EntryActions;
  context: ReviewContext;
  link: RowLink;
}) {
  const { error } = entry;
  const headline = error ? failureText(error) : "";
  const pending = entry.state === "queued" || entry.state === "reading";
  const review = context.review[entry.id];
  const natural = useImageSize(entry.previewUrl);

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
        <TryResult
          // A re-read starts the review over: the rows stagger in again.
          key={review?.token}
          imageId={entry.id}
          result={entry.body.result}
          durationMs={entry.body.durationMs}
          review={review}
          dispatch={context.dispatch}
          screenshot={entry.previewUrl && natural ? { src: entry.previewUrl, natural } : null}
          activeRowId={link.activeRowId}
          onActiveRow={(rowId) => link.setActiveRow(rowId, "rows")}
          selection={link.selection}
          characters={context.characters}
        />
      )}

      <Flex gap="3" wrap="wrap">
        {entry.state === "done" && entry.body && (
          <Button
            size="2"
            variant="soft"
            title="The corrected rows as an extractor fixture (expected.json). Nothing is uploaded."
            onClick={() => {
              const looksLikeBankLog = entry.body?.result.looksLikeBankLog ?? false;
              downloadText(
                fixtureFileName(entry.file.name),
                fixtureJson(buildFixture(looksLikeBankLog, correctedRows(review))),
                "application/json",
              );
            }}
          >
            Download fixture
          </Button>
        )}
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

/**
 * The screenshot. When the rows carry their position (`box`), the lit row gets
 * a translucent band and a click picks the row under it; otherwise a click
 * opens the image full size, as before.
 */
function Screenshot({
  entry,
  layout,
  review,
  link,
}: {
  entry: QueueEntry;
  /** "side": sticky column beside the rows. "top": above them, height-capped. "card": in a phone card, full size. */
  layout: "side" | "top" | "card";
  review: ImageReview | undefined;
  link: RowLink;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const rows = isBankLog(entry) ? activeRows(review) : [];
  const linked = rows.some((row) => row.box !== null);
  const band = rows.find((row) => row.id === link.activeRowId)?.box ?? null;
  const follow = layout !== "card" && link.activeFrom === "rows";
  const className = layout === "side" ? styles.shot : layout === "top" ? styles.shotTop : styles.shotStacked;

  // "side" and "top" scroll inside their own box, so bring the lit row into it. In a card the page would jump.
  useEffect(() => {
    const container = scroller.current;
    const element = bandRef.current;
    if (!follow || !band || !container || !element) return;
    if (container.scrollHeight <= container.clientHeight) return;
    const outer = container.getBoundingClientRect();
    const inner = element.getBoundingClientRect();
    if (inner.top < outer.top) container.scrollTop -= outer.top - inner.top + 8;
    else if (inner.bottom > outer.bottom) container.scrollTop += inner.bottom - outer.bottom + 8;
  }, [follow, band]);

  function rowUnder(event: MouseEvent<HTMLElement>): string | null {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.height === 0) return null;
    return rowAtFraction(rows, (event.clientY - rect.top) / rect.height);
  }

  const image = entry.previewUrl && (
    // eslint-disable-next-line @next/next/no-img-element
    <img className={styles.shotImage} src={entry.previewUrl} alt={`Screenshot ${displayName(entry)}`} />
  );

  return (
    <Flex direction="column" gap="2" className={className} ref={scroller}>
      {!entry.previewUrl ? (
        <Text size="2" color="gray">
          No preview for this file.
        </Text>
      ) : linked ? (
        // A pointer shortcut only: by keyboard the rows themselves are the way in.
        <div
          className={reviewStyles.shotFrame}
          data-linked="true"
          title="Click a row to find it in the list"
          onClick={(event) => {
            const rowId = rowUnder(event);
            if (rowId) link.selectRow(rowId);
          }}
          onMouseMove={(event) => link.setActiveRow(rowUnder(event), "shot")}
          onMouseLeave={() => link.setActiveRow(null, "shot")}
        >
          {image}
          {band && (
            <div
              ref={bandRef}
              className={reviewStyles.band}
              style={{ top: `${band.top * 100}%`, height: `${(band.bottom - band.top) * 100}%` }}
            />
          )}
        </div>
      ) : (
        <a href={entry.previewUrl} target="_blank" rel="noreferrer" title="Open full size in a new tab">
          {image}
        </a>
      )}
      <Flex align="center" justify="between" gap="3" minWidth="0">
        <Text size="1" color="gray" truncate>
          {displayName(entry)} · {formatBytes(entry.file.size)}
        </Text>
        {linked && entry.previewUrl && (
          <Text size="1" style={{ flexShrink: 0 }} asChild>
            <a href={entry.previewUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent-11)" }}>
              Open full size
            </a>
          </Text>
        )}
      </Flex>
    </Flex>
  );
}

/** Desktop: the image list on the left. */
export function EntryRail({
  entries,
  review,
  selectedId,
  onSelect,
  onRemove,
}: {
  entries: readonly QueueEntry[];
  review: ReviewState;
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
            review={review[entry.id]}
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

/** Desktop: the selected image, screenshot beside its editable rows. */
export function EntryDetail({
  entry,
  paused,
  actions,
  context,
}: {
  entry: QueueEntry;
  paused: boolean;
  actions: EntryActions;
  context: ReviewContext;
}) {
  const link = useRowLink();
  // The rows table needs about 620px. From 1280px the screenshot stands beside it; between 1024px and
  // that there is no room for both, so it goes on top, capped in height.
  const beside = useMediaQuery(BESIDE_QUERY);
  return (
    <Grid columns={beside ? "minmax(0, 1fr) minmax(0, 2.4fr)" : "minmax(0, 1fr)"} gap="4" align="start">
      <Screenshot entry={entry} layout={beside ? "side" : "top"} review={context.review[entry.id]} link={link} />
      <EntryBody entry={entry} paused={paused} actions={actions} context={context} link={link} />
    </Grid>
  );
}

function EntryCardPanel({
  entry,
  panelId,
  paused,
  actions,
  context,
}: {
  entry: QueueEntry;
  panelId: string;
  paused: boolean;
  actions: EntryActions;
  context: ReviewContext;
}) {
  const link = useRowLink();
  return (
    <Flex id={panelId} direction="column" gap="4" pt="3" minWidth="0">
      <Screenshot entry={entry} layout="card" review={context.review[entry.id]} link={link} />
      <EntryBody entry={entry} paused={paused} actions={actions} context={context} link={link} />
    </Flex>
  );
}

/** Phones and tablets: one collapsible card per image. */
export function EntryCards({
  entries,
  openId,
  paused,
  onToggle,
  actions,
  context,
}: {
  entries: readonly QueueEntry[];
  openId: string | null;
  paused: boolean;
  onToggle: (id: string) => void;
  actions: EntryActions;
  context: ReviewContext;
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
                review={context.review[entry.id]}
                mode="card"
                selected={open}
                controls={panelId}
                onSelect={() => onToggle(entry.id)}
                onRemove={() => actions.onRemove(entry.id)}
              />
              {open && (
                <EntryCardPanel entry={entry} panelId={panelId} paused={paused} actions={actions} context={context} />
              )}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}
