"use client";

import { type KeyboardEvent } from "react";
import { useReducedMotion } from "motion/react";
import { Badge, Box, Button, Callout, Dialog, Flex, IconButton, Kbd, Select, Text } from "@radix-ui/themes";
import { checkSequence, holdsRows, type PageAction } from "@/modules/playground/batch";
import { isManualEntry, type QueueEntry } from "@/modules/playground/queue";
import {
  reviewCounts,
  rowsInScope,
  type ImageReview,
  type ReviewAction,
  type ReviewCounts,
  type ReviewState,
} from "@/modules/playground/review";
import type { CharacterTotal } from "@/modules/playground/summary";
import { ReviewRows } from "./ReviewRows";
import { ShotPane } from "./ShotPane";
import { displayName, formatBytes } from "./TryEntries";
import { ToCheckBadge } from "./TryResult";
import { BESIDE_QUERY, useImageSize, useMediaQuery, useRowLink } from "./hooks";
import styles from "./CheckDialog.module.css";
import tryStyles from "./TryPlayground.module.css";

/** Radix Select cannot hold "" (the rows without a name), so the filter is encoded. */
const ALL_CHARACTERS = "all";
const encodeCharacter = (character: string | null) => (character === null ? ALL_CHARACTERS : `c:${character}`);
const decodeCharacter = (value: string) => (value === ALL_CHARACTERS ? null : value.slice(2));

export interface CheckDialogProps {
  /** The image shown; null keeps the dialog closed. */
  entry: QueueEntry | null;
  entries: readonly QueueEntry[];
  review: ReviewState;
  dispatch: (action: ReviewAction | PageAction) => void;
  /** Character names read anywhere in the batch, offered while typing one. */
  characters: readonly string[];
  /** Rows per character across the batch, for the filter. */
  characterTotals: readonly CharacterTotal[];
  character: string | null;
  /** "Go to Confirm" on the last image: close and show the confirm panel. */
  onGoToConfirm: () => void;
  /** The dialog is gone and focus is about to return to the page; `event.preventDefault()` keeps it where the handler put it. */
  onClosed?: (event: Event) => void;
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

/**
 * The check step: one image at a time, screenshot beside its editable rows
 * (CLAUDE.md decision 6). Near full-screen; ←/→ move between images, Esc closes.
 */
export function CheckDialog(props: CheckDialogProps) {
  return (
    <Dialog.Root
      open={props.entry !== null}
      onOpenChange={(open) => {
        if (!open) props.dispatch({ type: "closeCheck" });
      }}
    >
      {props.entry && <CheckDialogContent {...props} entry={props.entry} />}
    </Dialog.Root>
  );
}

function CheckDialogContent({
  entry,
  entries,
  review,
  dispatch,
  characters,
  characterTotals,
  character,
  onGoToConfirm,
  onClosed,
}: CheckDialogProps & { entry: QueueEntry }) {
  const beside = useMediaQuery(BESIDE_QUERY) && !entry.blank;
  const animate = !useReducedMotion();
  const sequence = checkSequence(entries);
  const index = sequence.indexOf(entry.id);
  const prevId = index > 0 ? sequence[index - 1] : null;
  const nextId = index >= 0 && index < sequence.length - 1 ? sequence[index + 1] : null;
  const image = review[entry.id];
  const counts = reviewCounts(image, character);
  const manual = isManualEntry(entry);
  const checked = counts.rows - counts.toCheck;
  const batchToCheck = entries.reduce(
    (sum, candidate) => sum + (holdsRows(candidate) ? reviewCounts(review[candidate.id], character).toCheck : 0),
    0,
  );

  function go(imageId: string | null) {
    if (imageId) dispatch({ type: "openCheck", imageId });
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const target = event.target as HTMLElement;
    // Portaled pickers bubble through React but not the DOM; fields use the arrows themselves.
    if (!event.currentTarget.contains(target)) return;
    if (target.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox']")) return;
    event.preventDefault();
    go(event.key === "ArrowLeft" ? prevId : nextId);
  }

  const statusBadge =
    counts.rows === 0 ? (
      <Badge color="gray" variant="soft" size="1">
        No rows yet
      </Badge>
    ) : counts.toCheck === 0 ? (
      <Badge color="green" variant="soft" size="1">
        All checked
      </Badge>
    ) : (
      <Badge color="amber" variant="soft" size="1" className={tryStyles.numeric}>
        {checked} of {counts.rows} checked
      </Badge>
    );

  return (
    <Dialog.Content
      className={styles.dialog}
      size="2"
      aria-describedby={undefined}
      onKeyDown={onKeyDown}
      onCloseAutoFocus={onClosed}
    >
      <div className={styles.head}>
        <div className={styles.headName}>
          <Dialog.Title size="3" mb="0" truncate title={displayName(entry)}>
            {displayName(entry)}
          </Dialog.Title>
          <span aria-live="polite">{statusBadge}</span>
        </div>

        <Flex align="center" gap="1">
          <IconButton
            size="1"
            variant="soft"
            color="gray"
            disabled={prevId === null}
            aria-label="Previous image"
            title="Previous image (←)"
            onClick={() => go(prevId)}
          >
            <ArrowIcon direction="left" />
          </IconButton>
          <Text size="1" color="gray" className={tryStyles.numeric} aria-label={`Image ${index + 1} of ${sequence.length}`}>
            {index + 1} / {sequence.length}
          </Text>
          <IconButton
            size="1"
            variant="soft"
            color="gray"
            disabled={nextId === null}
            aria-label="Next image"
            title="Next image (→)"
            onClick={() => go(nextId)}
          >
            <ArrowIcon direction="right" />
          </IconButton>
        </Flex>

        {characterTotals.length > 1 && (
          <Select.Root
            size="1"
            value={encodeCharacter(character)}
            onValueChange={(value) => dispatch({ type: "filterCharacter", character: decodeCharacter(value) })}
          >
            <Select.Trigger variant="soft" color="gray" aria-label="Show rows of one character" />
            <Select.Content position="popper">
              <Select.Item value={ALL_CHARACTERS}>All characters</Select.Item>
              {characterTotals.map((total) => (
                <Select.Item key={total.character} value={encodeCharacter(total.character)}>
                  {total.character || "No name"} · {total.rows}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        )}

        {!manual && (
          <Button
            size="1"
            variant="soft"
            disabled={counts.acceptable === 0}
            title="Checks every row that does not need a closer look. Fragments, silver, unknown and unsure rows stay yours to tap."
            onClick={() => dispatch({ type: "checkAllSafe", imageId: entry.id })}
          >
            Accept all safe rows
          </Button>
        )}

        <Dialog.Close>
          <IconButton size="2" variant="ghost" color="gray" aria-label="Close" title="Close (Esc)">
            <CloseIcon />
          </IconButton>
        </Dialog.Close>
      </div>

      {/* Keyed so a different image (or a re-read) starts its rows, and the row link, over. */}
      <Body
        key={`${entry.id}:${image?.token ?? 0}`}
        entry={entry}
        image={image}
        counts={counts}
        character={character}
        characters={characters}
        dispatch={dispatch}
        beside={beside}
        animate={animate}
        manual={manual}
      />

      <div className={styles.foot}>
        <Flex align="center" gap="3" wrap="wrap">
          <span aria-live="polite">
            <ToCheckBadge rows={counts.rows} toCheck={counts.toCheck} size="2" />
          </span>
          {batchToCheck > counts.toCheck && (
            <Text size="1" color="gray" className={tryStyles.numeric}>
              {batchToCheck} to check in the batch
            </Text>
          )}
          <Box display={{ initial: "none", md: "block" }}>
            <Text size="1" color="gray">
              <Kbd size="1">←</Kbd> <Kbd size="1">→</Kbd> images · <Kbd size="1">Esc</Kbd> closes
            </Text>
          </Box>
        </Flex>
        <div className={styles.footActions}>
          <Dialog.Close>
            <Button size="2" variant="soft" color="gray">
              Done
            </Button>
          </Dialog.Close>
          {nextId !== null ? (
            <Button size="2" onClick={() => go(nextId)}>
              Next image
              <ArrowIcon direction="right" />
            </Button>
          ) : (
            <Button size="2" onClick={onGoToConfirm}>
              Go to Confirm
            </Button>
          )}
        </div>
      </div>
    </Dialog.Content>
  );
}

function Body({
  entry,
  image,
  counts,
  character,
  characters,
  dispatch,
  beside,
  animate,
  manual,
}: {
  entry: QueueEntry;
  image: ImageReview | undefined;
  counts: ReviewCounts;
  character: string | null;
  characters: readonly string[];
  dispatch: (action: ReviewAction | PageAction) => void;
  beside: boolean;
  animate: boolean;
  manual: boolean;
}) {
  const link = useRowLink();
  const natural = useImageSize(entry.previewUrl);
  const rows = rowsInScope(image, character);
  const warnings = entry.state === "done" ? (entry.body?.result.warnings ?? []) : [];
  const changed = counts.edited + counts.added + counts.deleted > 0;

  return (
    <div className={styles.body} data-layout={beside ? "beside" : "stacked"}>
      {!entry.blank && entry.previewUrl && (
        <ShotPane
          src={entry.previewUrl}
          name={displayName(entry)}
          sizeText={formatBytes(entry.file.size)}
          rows={rows}
          link={link}
        />
      )}
      <div className={styles.rows}>
        {warnings.length > 0 && (
          <Callout.Root color="amber" size="1">
            {warnings.map((warning, index) => (
              <Callout.Text key={index}>{warning}</Callout.Text>
            ))}
          </Callout.Root>
        )}
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Text size="2" color="gray">
            {counts.rows} {counts.rows === 1 ? "row" : "rows"}
            {manual ? " · added by hand · nothing is sent anywhere" : ""}
            {counts.edited > 0 ? ` · ${counts.edited} edited` : ""}
            {counts.added > 0 ? ` · ${counts.added} added` : ""}
          </Text>
          {changed && !manual && (
            <Button
              size="1"
              variant="ghost"
              color="gray"
              title="Back to what was read: forgets every edit, added and removed row"
              onClick={() => dispatch({ type: "reset", imageId: entry.id })}
            >
              Reset
            </Button>
          )}
        </Flex>
        {image && (
          <ReviewRows
            imageId={entry.id}
            review={image}
            dispatch={dispatch}
            screenshot={entry.previewUrl && natural ? { src: entry.previewUrl, natural } : null}
            activeRowId={link.activeRowId}
            onActiveRow={(rowId) => link.setActiveRow(rowId, "rows")}
            selection={link.selection}
            characters={characters}
            character={character}
            animate={animate}
            manual={manual}
          />
        )}
      </div>
    </div>
  );
}
