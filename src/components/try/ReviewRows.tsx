"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AnimatePresence, motion, usePresence } from "motion/react";
import {
  Badge,
  Button,
  Card,
  Flex,
  IconButton,
  Table,
  Text,
  TextField,
  Tooltip,
  VisuallyHidden,
} from "@radix-ui/themes";
import { findItem, fragmentLabel } from "@/catalog";
import { ItemChip, UnknownItemChip } from "@/components/ItemChip";
import {
  CONFIDENCE_COLOR,
  compactTimestamp,
  confidenceLevel,
  formatConfidence,
  formatQuantity,
} from "@/modules/playground";
import { parseQuantityInput } from "@/modules/playground/quantity";
import {
  UNKNOWN_ITEM_ID,
  activeRows,
  addRowDefaults,
  deletedRows,
  matchesCharacter,
  rowLookReasons,
  rowsInScope,
  type ImageReview,
  type LookReason,
  type ReviewAction,
  type ReviewRow,
} from "@/modules/playground/review";
import { CheckButton, type CheckState } from "./CheckButton";
import { InlineText } from "./InlineText";
import { ItemPicker } from "./ItemPicker";
import { QuantityEditor, QuantitySanity, SuffixKeys, withSuffix } from "./QuantityEditor";
import { ScreenshotStrip } from "./ScreenshotStrip";
import { TABLE_QUERY, useMediaQuery, type ImageSize } from "./hooks";
import styles from "./Review.module.css";
import tryStyles from "./TryPlayground.module.css";

const MotionTableRow = motion.create(Table.Row);

const ROW_DURATION = 0.25;
const ROW_STAGGER = 0.04;

/** Rows stagger in; the delay stops growing so a long log does not crawl. */
function rowDelay(index: number): number {
  return Math.min(index, 15) * ROW_STAGGER;
}

export interface ScreenshotSource {
  src: string;
  natural: ImageSize;
}

/** A row picked on the screenshot; `nonce` makes picking the same row twice count twice. */
export interface RowSelection {
  rowId: string;
  nonce: number;
}

export interface ReviewRowsProps {
  imageId: string;
  review: ImageReview;
  dispatch: (action: ReviewAction) => void;
  /** The screenshot, for the enlarged strips; null when there is no preview (or it has not loaded). */
  screenshot: ScreenshotSource | null;
  activeRowId: string | null;
  /** A row is hovered or focused (null: no longer). Draws the band on the screenshot. */
  onActiveRow: (rowId: string | null) => void;
  selection: RowSelection | null;
  /** Character names read from the batch, offered while typing one. */
  characters: readonly string[];
  /** Only this character's rows are shown (""; the rows without a name); null shows every row. */
  character?: string | null;
  animate: boolean;
  /**
   * A manual entry: every row is typed by hand. The add-row form is open from
   * the start and stays open after each saved row (focus on the fresh form, the
   * game time and character carried over), and the "Sure" column is left out:
   * there is no model confidence to show.
   */
  manual?: boolean;
}

function itemName(itemId: string): string {
  return findItem(itemId)?.name ?? "Unknown item";
}

/** Fragments go by their short name in a row ("Ring of Night"); the full one is the tooltip. */
function Chip({ itemId }: { itemId: string }) {
  const item = findItem(itemId);
  if (!item) return <UnknownItemChip />;
  return <ItemChip item={item} label={item.kind === "fragment" ? fragmentLabel(item) : undefined} />;
}

function checkState(row: ReviewRow): CheckState {
  if (!row.checked) return "unchecked";
  return row.auto ? "auto" : "checked";
}

function reasonText(reason: LookReason, row: ReviewRow): string {
  switch (reason) {
    case "low_confidence":
      return `only ${formatConfidence(row.confidence ?? 0)} sure`;
    case "unknown_item":
      return "not recognised, pick the item";
    case "fragment":
      return "fragment, compare the icon";
    case "silver":
      return "silver, check the magnitude";
    case "quantity_text":
      return `amount shown as “${row.quantityText}”`;
  }
}

/** Under the item: why the row waits for a check, what the icon looked like, what was read before a correction. */
function RowNotes({ row }: { row: ReviewRow }) {
  const reasons = row.checked ? [] : rowLookReasons(row);
  const itemWas = row.original && row.original.itemId !== row.current.itemId ? row.original.itemId : null;
  const looksLike = row.current.itemId === UNKNOWN_ITEM_ID && row.iconDescription;
  const modelReason = !row.checked && row.lowConfidenceReason;
  if (reasons.length === 0 && !itemWas && !looksLike && !modelReason) return null;
  return (
    <span className={styles.reasons}>
      {reasons.length > 0 && (
        <Text as="div" size="1" color="amber">
          Check: {reasons.map((reason) => reasonText(reason, row)).join(" · ")}
        </Text>
      )}
      {modelReason && (
        <Text as="div" size="1" color="gray">
          {modelReason}
        </Text>
      )}
      {looksLike && (
        <Text as="div" size="1" color="gray">
          Looks like: {row.iconDescription}
        </Text>
      )}
      {itemWas && (
        <Text as="div" size="1" className={styles.wasRead}>
          read as {itemName(itemWas)}
        </Text>
      )}
    </span>
  );
}

function RowBadge({ row }: { row: ReviewRow }) {
  if (row.added) {
    return (
      <Badge color="gray" variant="surface" size="1">
        Added
      </Badge>
    );
  }
  const confidence = row.confidence ?? 0;
  const level = confidenceLevel(confidence);
  const badge = (
    <Badge
      color={CONFIDENCE_COLOR[level]}
      variant="soft"
      size="1"
      className={tryStyles.numeric}
      // Focusable so the reason is reachable by keyboard and by tap.
      tabIndex={row.lowConfidenceReason ? 0 : undefined}
    >
      {formatConfidence(confidence)}
    </Badge>
  );
  return row.lowConfidenceReason ? <Tooltip content={row.lowConfidenceReason}>{badge}</Tooltip> : badge;
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
    </svg>
  );
}

/** Everything one row needs, whichever layout draws it. */
interface RowProps {
  row: ReviewRow;
  index: number;
  imageId: string;
  dispatch: (action: ReviewAction) => void;
  screenshot: ScreenshotSource | null;
  active: boolean;
  onActiveRow: (rowId: string | null) => void;
  onDelete: (rowId: string) => void;
  characters: readonly string[];
  animate: boolean;
  /** Back from "Removed": no stagger, no pulse. */
  restored: boolean;
  /** A manual entry: no confidence to show. */
  manual: boolean;
}

/** The handlers and flags both layouts share. */
function useRow({ row, index, imageId, dispatch, animate, restored }: RowProps) {
  // The single pulse belongs to the first time the row shows up waiting; never to a later uncheck.
  const [pulse, setPulse] = useState(!row.checked && !restored);
  const flagged = !row.checked;
  const delay = row.added || restored ? 0 : rowDelay(index);
  const level = row.confidence !== null && confidenceLevel(row.confidence) === "low" ? "low" : "medium";
  const label = `${itemName(row.current.itemId)}, ${formatQuantity(row.current.quantity)}`;

  const flagProps = flagged
    ? {
        "data-level": level,
        // The pulse starts once the row has faded in.
        style: { animationDelay: animate ? `${delay + ROW_DURATION}s` : "0s" },
        onAnimationEnd: () => setPulse(false),
      }
    : {};
  const flagClass = flagged ? ` ${tryStyles.flagged}${pulse && animate ? ` ${tryStyles.flagPulse}` : ""}` : "";

  return {
    delay,
    label,
    flagProps,
    flagClass,
    toggle: () => {
      setPulse(false);
      dispatch({ type: "toggleChecked", imageId, rowId: row.id });
    },
    setItem: (itemId: string) => {
      setPulse(false);
      dispatch({ type: "setItem", imageId, rowId: row.id, itemId });
    },
    setQuantity: (quantity: string) => {
      setPulse(false);
      dispatch({ type: "setQuantity", imageId, rowId: row.id, quantity });
    },
    setTimestamp: (gameTimestamp: string) => dispatch({ type: "setTimestamp", imageId, rowId: row.id, gameTimestamp }),
    setCharacter: (character: string) => dispatch({ type: "setCharacter", imageId, rowId: row.id, character }),
  };
}

function stripOf(row: ReviewRow, screenshot: ScreenshotSource | null): ReactNode {
  if (!row.box || !screenshot) return undefined;
  return <ScreenshotStrip src={screenshot.src} box={row.box} natural={screenshot.natural} />;
}

function isSilver(itemId: string): boolean {
  return findItem(itemId)?.kind === "currency";
}

function Cell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.cellInner}>
      <div>{children}</div>
    </div>
  );
}

/** Desktop: one dense table row. Collapses when deleted (the cells shrink, then the row leaves). */
function TableRow(props: RowProps) {
  const { row, screenshot, active, onActiveRow, onDelete, characters, animate, manual } = props;
  const bits = useRow(props);
  const [isPresent, safeToRemove] = usePresence();

  useEffect(() => {
    if (isPresent) return;
    if (!animate) {
      safeToRemove();
      return;
    }
    const id = window.setTimeout(safeToRemove, ROW_DURATION * 1000);
    return () => window.clearTimeout(id);
  }, [isPresent, animate, safeToRemove]);

  const className = `${tryStyles.row}${bits.flagClass}${active ? ` ${styles.rowActive}` : ""}${
    isPresent ? "" : ` ${styles.collapsing}`
  }`;

  return (
    <MotionTableRow
      align="center"
      data-row-id={row.id}
      className={className}
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: ROW_DURATION, ease: "easeOut", delay: bits.delay }}
      onMouseEnter={() => onActiveRow(row.id)}
      onMouseLeave={() => onActiveRow(null)}
      onFocus={() => onActiveRow(row.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActiveRow(null);
      }}
      {...bits.flagProps}
    >
      <Table.Cell className={styles.checkCell}>
        <Cell>
          <CheckButton dense state={checkState(row)} label={bits.label} onToggle={bits.toggle} />
        </Cell>
      </Table.Cell>
      <Table.RowHeaderCell className={styles.itemCell}>
        <Cell>
          <ItemPicker
            value={row.current.itemId}
            label={`Item: ${itemName(row.current.itemId)}`}
            sheet={false}
            strip={stripOf(row, screenshot)}
            onSelect={bits.setItem}
          >
            <Chip itemId={row.current.itemId} />
          </ItemPicker>
          <RowNotes row={row} />
        </Cell>
      </Table.RowHeaderCell>
      <Table.Cell justify="end" className={styles.fitCell}>
        <Cell>
          <QuantityEditor
            value={row.current.quantity}
            readAs={row.original?.quantity}
            alwaysCompact={isSilver(row.current.itemId)}
            label={`Quantity of ${itemName(row.current.itemId)}`}
            onSave={bits.setQuantity}
          />
        </Cell>
      </Table.Cell>
      <Table.Cell className={styles.fitCell}>
        <Cell>
          <InlineText
            numeric
            value={row.current.gameTimestamp}
            // Dense: the year stays on the screenshot, in the tooltip and in the editor.
            display={compactTimestamp}
            label={`Game time of ${bits.label}`}
            onSave={bits.setTimestamp}
          />
        </Cell>
      </Table.Cell>
      <Table.Cell className={styles.fitCell}>
        <Cell>
          <InlineText
            value={row.current.character}
            label={`Character of ${bits.label}`}
            suggestions={characters}
            onSave={bits.setCharacter}
          />
        </Cell>
      </Table.Cell>
      {!manual && (
        <Table.Cell justify="end" className={styles.fitCell}>
          <Cell>
            <RowBadge row={row} />
          </Cell>
        </Table.Cell>
      )}
      <Table.Cell className={styles.actionsCell}>
        <Cell>
          <IconButton
            size="1"
            variant="ghost"
            color="gray"
            aria-label={`Remove row: ${bits.label}`}
            title="Remove this row"
            onClick={() => onDelete(row.id)}
          >
            <TrashIcon />
          </IconButton>
        </Cell>
      </Table.Cell>
    </MotionTableRow>
  );
}

/** Phones: check on the left, item + quantity, tap the line below for the rest. */
function CardRow(props: RowProps & { expanded: boolean; onExpand: (rowId: string) => void }) {
  const { row, screenshot, active, onActiveRow, onDelete, characters, animate, manual, expanded, onExpand } = props;
  const bits = useRow(props);
  const detailsId = `row-details-${props.imageId}-${row.id}`;

  return (
    <motion.li
      data-row-id={row.id}
      className={`${styles.cardRow}${bits.flagClass}${active ? ` ${styles.rowActive}` : ""}`}
      initial={animate ? { opacity: 0, y: 6 } : false}
      animate={{ opacity: 1, y: 0, height: "auto" }}
      exit={animate ? { opacity: 0, height: 0 } : undefined}
      transition={{ duration: ROW_DURATION, ease: "easeOut", delay: bits.delay }}
      onFocus={() => onActiveRow(row.id)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onActiveRow(null);
      }}
      {...bits.flagProps}
    >
      <div className={styles.cardMain}>
        <CheckButton state={checkState(row)} label={bits.label} onToggle={bits.toggle} />
        <div className={styles.cardBody}>
          <Flex align="start" justify="between" gap="2" minWidth="0">
            <Flex direction="column" minWidth="0">
              <ItemPicker
                value={row.current.itemId}
                label={`Item: ${itemName(row.current.itemId)}`}
                sheet
                strip={stripOf(row, screenshot)}
                onSelect={bits.setItem}
              >
                <Chip itemId={row.current.itemId} />
              </ItemPicker>
            </Flex>
            <QuantityEditor
              suffixKeys
              value={row.current.quantity}
              readAs={row.original?.quantity}
              alwaysCompact={isSilver(row.current.itemId)}
              label={`Quantity of ${itemName(row.current.itemId)}`}
              onSave={bits.setQuantity}
            />
          </Flex>
          <RowNotes row={row} />
          <button
            type="button"
            className={styles.expandToggle}
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => onExpand(row.id)}
          >
            <Text size="1" truncate>
              {row.current.character || "No name"} · {row.current.gameTimestamp || "no time"}
            </Text>
            <Chevron open={expanded} />
          </button>
        </div>
      </div>
      {expanded && (
        <div id={detailsId} className={styles.cardDetails}>
          <div className={styles.fieldGrid}>
            <Text size="1" color="gray">
              Game time
            </Text>
            <span>
              <InlineText
                numeric
                value={row.current.gameTimestamp}
                label={`Game time of ${bits.label}`}
                onSave={bits.setTimestamp}
              />
            </span>
            <Text size="1" color="gray">
              Character
            </Text>
            <span>
              <InlineText
                value={row.current.character}
                label={`Character of ${bits.label}`}
                suggestions={characters}
                onSave={bits.setCharacter}
              />
            </span>
          </div>
          {row.box && screenshot && (
            <ScreenshotStrip src={screenshot.src} box={row.box} natural={screenshot.natural} />
          )}
          <Flex align="center" justify="between" gap="3">
            <Flex align="center" gap="2">
              {!manual && <RowBadge row={row} />}
              {row.edited && (
                <Badge color="gray" variant="surface" size="1">
                  Edited
                </Badge>
              )}
            </Flex>
            <Button size="1" variant="soft" color="gray" onClick={() => onDelete(row.id)}>
              <TrashIcon />
              Remove row
            </Button>
          </Flex>
        </div>
      )}
    </motion.li>
  );
}

// Ids come from `useId`: the same form may be on the page twice (an inline card and the check dialog).

/**
 * "Add row": item, quantity, game time, character (the last two start from the
 * row above). Enter in any field submits; picking the item sends the focus on
 * to the quantity.
 */
function AddRowForm({
  review,
  sheet,
  characters,
  character,
  focusOnMount,
  cancelLabel,
  onAdd,
  onCancel,
}: {
  review: ImageReview;
  sheet: boolean;
  characters: readonly string[];
  /** The character filter in force: a new row starts with that name. */
  character: string | null;
  /**
   * Put the focus on the item picker when the form appears: "quiet" without
   * scrolling (a manual entry just opened), "follow" scrolling to it (the fresh
   * form after a saved row, so the next row can be typed straight away).
   */
  focusOnMount: "quiet" | "follow" | null;
  cancelLabel: string;
  onAdd: (values: { itemId: string; quantity: string; gameTimestamp: string; character: string }) => void;
  onCancel: () => void;
}) {
  const defaults = addRowDefaults(review);
  const id = useId();
  const ids = {
    item: `${id}-item`,
    quantity: `${id}-quantity`,
    sanity: `${id}-sanity`,
    time: `${id}-time`,
    character: `${id}-character`,
    list: `${id}-characters`,
  };
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [gameTimestamp, setGameTimestamp] = useState(defaults.gameTimestamp);
  const [characterName, setCharacter] = useState(character ?? defaults.character);
  const quantityRef = useRef<HTMLInputElement | null>(null);
  const parsed = parseQuantityInput(quantity);
  const ready = itemId !== "" && parsed.ok;

  useEffect(() => {
    if (!focusOnMount) return;
    document.getElementById(ids.item)?.focus({ preventScroll: focusOnMount === "quiet" });
    // Only when the form appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Card size="1" asChild>
      <form
        aria-label="Add a row"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onAdd({ itemId, quantity: parsed.digits, gameTimestamp, character: characterName });
        }}
        onKeyDown={(event) => {
          // Escape inside the item picker (a portal: outside the form's DOM) only closes the picker.
          if (event.key === "Escape" && event.currentTarget.contains(event.target as Node)) onCancel();
        }}
      >
        <div className={styles.addForm}>
          <Flex direction="column" gap="1" minWidth="0">
            <Text size="1" color="gray" weight="medium">
              Item
            </Text>
            <span>
              <ItemPicker
                value={itemId}
                label={itemId ? `Item: ${itemName(itemId)}` : "Item: none yet"}
                sheet={sheet}
                triggerId={ids.item}
                focusAfterPick={() => quantityRef.current?.focus()}
                onSelect={setItemId}
              >
                {itemId ? (
                  <Chip itemId={itemId} />
                ) : (
                  <Text size="2" color="amber">
                    Pick the item…
                  </Text>
                )}
              </ItemPicker>
            </span>
          </Flex>
          <Flex direction="column" gap="1" minWidth="0">
            <Text as="label" size="1" color="gray" weight="medium" htmlFor={ids.quantity}>
              Quantity
            </Text>
            <TextField.Root
              ref={quantityRef}
              id={ids.quantity}
              size="2"
              inputMode="decimal"
              autoComplete="off"
              placeholder="500,000,000 or 500m"
              aria-describedby={ids.sanity}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
            />
            <QuantitySanity input={quantity} id={ids.sanity} />
            {sheet && <SuffixKeys onPick={(suffix) => setQuantity((current) => withSuffix(current, suffix))} />}
          </Flex>
          <Flex direction="column" gap="1" minWidth="0">
            <Text as="label" size="1" color="gray" weight="medium" htmlFor={ids.time}>
              Game time
            </Text>
            <TextField.Root
              id={ids.time}
              size="2"
              autoComplete="off"
              placeholder="06.09.2026 - 23:21"
              value={gameTimestamp}
              onChange={(event) => setGameTimestamp(event.target.value)}
            />
          </Flex>
          <Flex direction="column" gap="1" minWidth="0">
            <Text as="label" size="1" color="gray" weight="medium" htmlFor={ids.character}>
              Character
            </Text>
            <TextField.Root
              id={ids.character}
              size="2"
              autoComplete="off"
              list={ids.list}
              value={characterName}
              onChange={(event) => setCharacter(event.target.value)}
            />
            <datalist id={ids.list}>
              {characters.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Flex>
          <Flex gap="2" justify="end" className={styles.addFormWide}>
            <Button type="button" size="2" variant="soft" color="gray" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button type="submit" size="2" disabled={!ready}>
              Add row
            </Button>
          </Flex>
        </div>
      </form>
    </Card>
  );
}

/** Deleted rows, out of the way but one tap from coming back. */
function Removed({
  rows,
  lastDeletedId,
  undoRef,
  onRestore,
}: {
  rows: readonly ReviewRow[];
  lastDeletedId: string | null;
  undoRef: React.RefObject<HTMLButtonElement | null>;
  onRestore: (rowId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (rows.length === 0) return null;
  const last = rows.find((row) => row.id === lastDeletedId) ?? rows.at(-1);

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" justify="between" gap="3">
        <button
          type="button"
          className={styles.expandToggle}
          style={{ width: "auto" }}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Text size="2">Removed ({rows.length})</Text>
          <Chevron open={open} />
        </button>
        {last && (
          <Button ref={undoRef} size="1" variant="soft" color="gray" onClick={() => onRestore(last.id)}>
            Undo
          </Button>
        )}
      </Flex>
      {open && (
        <ul className={styles.removedList}>
          {rows.map((row) => (
            <li key={row.id} className={styles.removedRow}>
              <Flex align="center" gap="3" minWidth="0">
                <Chip itemId={row.current.itemId} />
                <Text size="2" color="gray" className={tryStyles.numeric}>
                  {formatQuantity(row.current.quantity)}
                </Text>
              </Flex>
              <Button size="1" variant="ghost" onClick={() => onRestore(row.id)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Flex>
  );
}

/**
 * The editable rows of one image: a dense table from 768px, cards below.
 * ↑/↓ on a check button moves between rows; Space toggles it.
 */
export function ReviewRows({
  imageId,
  review,
  dispatch,
  screenshot,
  activeRowId,
  onActiveRow,
  selection,
  characters,
  character = null,
  animate,
  manual = false,
}: ReviewRowsProps) {
  const wide = useMediaQuery(TABLE_QUERY);
  const container = useRef<HTMLDivElement | null>(null);
  const undoRef = useRef<HTMLButtonElement | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [seenNonce, setSeenNonce] = useState<number | null>(null);
  const [lastDeletedId, setLastDeletedId] = useState<string | null>(null);
  const [restoredIds, setRestoredIds] = useState<ReadonlySet<string>>(new Set());
  // A manual entry is for adding rows: its form is open from the start.
  const [adding, setAdding] = useState(manual);
  /** Rows saved through the form so far: a new number is a fresh form (manual entries keep it open). */
  const [formRound, setFormRound] = useState(0);

  // A row picked on the screenshot opens its card (phones)...
  if (selection && selection.nonce !== seenNonce) {
    setSeenNonce(selection.nonce);
    setExpandedId(selection.rowId);
  }

  // ...and takes the focus, which also scrolls it into view.
  useEffect(() => {
    if (!selection) return;
    const row = container.current?.querySelector(`[data-row-id="${CSS.escape(selection.rowId)}"]`);
    row?.querySelector<HTMLElement>("[data-row-check]")?.focus();
  }, [selection]);

  const rows = rowsInScope(review, character);
  const hidden = activeRows(review).length - rows.length;
  const removed = deletedRows(review).filter((row) => matchesCharacter(row.current, character));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const target = event.target as HTMLElement;
    if (!target.matches("[data-row-check]")) return;
    const checks = Array.from(container.current?.querySelectorAll<HTMLElement>("[data-row-check]") ?? []);
    const next = checks[checks.indexOf(target) + (event.key === "ArrowDown" ? 1 : -1)];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }

  function onDelete(rowId: string) {
    dispatch({ type: "deleteRow", imageId, rowId });
    setLastDeletedId(rowId);
    if (activeRowId === rowId) onActiveRow(null);
    // The row's own buttons are about to go: Undo is the sensible next stop.
    // (A timeout, not a frame: it must also happen while the tab is not painting.)
    window.setTimeout(() => undoRef.current?.focus(), 0);
  }

  function onRestore(rowId: string) {
    dispatch({ type: "restoreRow", imageId, rowId });
    setRestoredIds((current) => new Set(current).add(rowId));
  }

  const shared = { imageId, dispatch, screenshot, onActiveRow, onDelete, characters, animate, manual };
  const emptyText =
    hidden > 0
      ? `No rows for ${character === "" ? "rows without a name" : character} in this image.`
      : removed.length > 0
        ? "Every row was removed."
        : manual
          ? "No rows yet. Add the first one below."
          : "No deposit rows were found in this screenshot.";
  const hiddenText =
    hidden > 0
      ? `${hidden} ${hidden === 1 ? "row" : "rows"} from other characters hidden`
      : null;

  return (
    <Flex direction="column" gap="3" ref={container} onKeyDown={onKeyDown}>
      {rows.length === 0 ? (
        <Card size="2">
          <Text size="2" color="gray">
            {emptyText}
          </Text>
        </Card>
      ) : wide ? (
        <Table.Root size="1" variant="surface" className={styles.denseTable}>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell className={styles.checkCell}>
                <VisuallyHidden>Checked</VisuallyHidden>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Item</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell justify="end">Qty</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Game time</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Character</Table.ColumnHeaderCell>
              {!manual && <Table.ColumnHeaderCell justify="end">Sure</Table.ColumnHeaderCell>}
              <Table.ColumnHeaderCell className={styles.actionsCell}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            <AnimatePresence initial>
              {rows.map((row, index) => (
                <TableRow
                  key={row.id}
                  row={row}
                  index={index}
                  active={row.id === activeRowId}
                  restored={restoredIds.has(row.id)}
                  {...shared}
                />
              ))}
            </AnimatePresence>
          </Table.Body>
        </Table.Root>
      ) : (
        <Card size="1">
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <AnimatePresence initial>
              {rows.map((row, index) => (
                <CardRow
                  key={row.id}
                  row={row}
                  index={index}
                  active={row.id === activeRowId}
                  restored={restoredIds.has(row.id)}
                  expanded={row.id === expandedId}
                  onExpand={(rowId) => setExpandedId((current) => (current === rowId ? null : rowId))}
                  {...shared}
                />
              ))}
            </AnimatePresence>
          </ul>
        </Card>
      )}

      {hiddenText && rows.length > 0 && (
        <Text size="1" color="gray" role="status">
          {hiddenText}
        </Text>
      )}

      <Removed rows={removed} lastDeletedId={lastDeletedId} undoRef={undoRef} onRestore={onRestore} />

      {adding ? (
        <AddRowForm
          // A fresh form per saved row: item and quantity empty, game time and character from the row just added.
          key={formRound}
          review={review}
          sheet={!wide}
          characters={characters}
          character={character}
          focusOnMount={manual ? (formRound === 0 ? "quiet" : "follow") : null}
          cancelLabel={manual ? "Close form" : "Cancel"}
          onCancel={() => setAdding(false)}
          onAdd={(values) => {
            dispatch({ type: "addRow", imageId, values });
            if (manual) setFormRound((round) => round + 1);
            else setAdding(false);
          }}
        />
      ) : (
        <Flex>
          <Button size="1" variant="soft" color="gray" onClick={() => setAdding(true)}>
            + Add row
          </Button>
        </Flex>
      )}
    </Flex>
  );
}
