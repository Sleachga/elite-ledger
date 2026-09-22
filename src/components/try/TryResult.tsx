"use client";

import { useReducedMotion } from "motion/react";
import { Badge, Button, Callout, Card, Flex, Grid, Heading, Text } from "@radix-ui/themes";
import { findItem } from "@/catalog";
import { ItemChip, UnknownItemChip } from "@/components/ItemChip";
import { formatQty } from "@/lib/format";
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import { totalsByItem, type ItemTotal } from "@/modules/playground";
import {
  correctedRows,
  reviewCounts,
  type ImageReview,
  type ReviewAction,
} from "@/modules/playground/review";
import { ReviewRows, type RowSelection, type ScreenshotSource } from "./ReviewRows";
import styles from "./TryPlayground.module.css";

function RowItem({ row, qty }: { row: Pick<ParsedRow, "itemId">; qty?: string }) {
  const item = findItem(row.itemId);
  return item ? <ItemChip item={item} qty={qty} /> : <UnknownItemChip qty={qty} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Flex direction="column" gap="2" asChild>
      <section>
        <Heading as="h2" size="3">
          {title}
        </Heading>
        {children}
      </section>
    </Flex>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return (
      <Text size="2" color="gray">
        None.
      </Text>
    );
  }
  return (
    <Callout.Root color="amber" size="1">
      {warnings.map((warning, index) => (
        <Callout.Text key={index}>{warning}</Callout.Text>
      ))}
    </Callout.Root>
  );
}

function RunFooter({ result, durationMs }: { result: ExtractionResult; durationMs: number }) {
  const { usage } = result;
  const parts = [
    result.model,
    `${(durationMs / 1000).toFixed(1)} s`,
    `${formatQty(usage.inputTokens)} in / ${formatQty(usage.outputTokens)} out tokens`,
  ];
  if (usage.cacheReadInputTokens > 0) parts.push(`${formatQty(usage.cacheReadInputTokens)} cache read`);
  if (usage.cacheCreationInputTokens > 0) {
    parts.push(`${formatQty(usage.cacheCreationInputTokens)} cache write`);
  }
  return (
    <Text as="p" size="1" color="gray" style={{ margin: 0 }}>
      {parts.join(" · ")}
    </Text>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/** "3 to check" in amber, or a green "All checked" once nothing waits. Nothing for an image without rows. */
export function ToCheckBadge({ rows, toCheck, size = "1" }: { rows: number; toCheck: number; size?: "1" | "2" }) {
  if (rows === 0) return null;
  return toCheck > 0 ? (
    <Badge color="amber" variant="soft" size={size} className={styles.numeric}>
      {toCheck} to check
    </Badge>
  ) : (
    <Badge color="green" variant="soft" size={size}>
      <CheckIcon />
      All checked
    </Badge>
  );
}

function TotalsSection({ title, totals }: { title: string; totals: ItemTotal[] }) {
  if (totals.length === 0) return null;
  return (
    <Section title={title}>
      <Card size="1">
        <Grid columns={{ initial: "1", sm: "2" }} gapX="6" gapY="2">
          {totals.map((total) => (
            <Flex key={total.itemId} align="center" justify="between" gap="3" minWidth="0">
              <RowItem row={total} />
              <Text size="2" weight="medium" className={styles.numeric}>
                {formatQty(total.total)}
                <Text size="1" color="gray" weight="regular">
                  {" "}
                  · {total.rows} {total.rows === 1 ? "row" : "rows"}
                </Text>
              </Text>
            </Flex>
          ))}
        </Grid>
      </Card>
    </Section>
  );
}

function CharactersSection({ names, empty }: { names: string[]; empty: string }) {
  return (
    <Section title="Characters">
      {names.length === 0 ? (
        <Text size="2" color="gray">
          {empty}
        </Text>
      ) : (
        <Flex gap="2" wrap="wrap">
          {names.map((name) => (
            <Badge key={name} color="gray" variant="surface" size="2">
              {name}
            </Badge>
          ))}
        </Flex>
      )}
    </Section>
  );
}

function characterNames(rows: readonly { character: string }[]): string[] {
  return [...new Set(rows.map((row) => row.character.trim()).filter((name) => name !== ""))];
}

export interface ManualResultProps {
  imageId: string;
  /** The rows typed so far. */
  review: ImageReview | undefined;
  dispatch: (action: ReviewAction) => void;
  /** Whether the entry has a screenshot to read the rows off. */
  hasScreenshot: boolean;
  activeRowId: string | null;
  onActiveRow: (rowId: string | null) => void;
  /** Character names known anywhere in the batch. */
  characters: readonly string[];
}

/**
 * A manual entry: the same rows table, totals and characters as a read, minus
 * everything that only a read has (confidence, "Accept all", warnings, the
 * model's footer). Nothing here talks to the server.
 */
export function ManualResult({
  imageId,
  review,
  dispatch,
  hasScreenshot,
  activeRowId,
  onActiveRow,
  characters,
}: ManualResultProps) {
  const animate = !useReducedMotion();
  const counts = reviewCounts(review);
  const rows = correctedRows(review);

  return (
    <Flex direction="column" gap="5">
      <Section title="Deposit rows">
        <Flex align="center" gap="2" wrap="wrap">
          <Text size="2" color="gray">
            {counts.rows} {counts.rows === 1 ? "row" : "rows"} · added by hand
            {hasScreenshot ? " from the screenshot" : ""} · nothing is sent anywhere
          </Text>
          <span aria-live="polite">
            <ToCheckBadge rows={counts.rows} toCheck={counts.toCheck} />
          </span>
        </Flex>
        {review && (
          <ReviewRows
            manual
            imageId={imageId}
            review={review}
            dispatch={dispatch}
            screenshot={null}
            activeRowId={activeRowId}
            onActiveRow={onActiveRow}
            selection={null}
            characters={characters}
            animate={animate}
          />
        )}
      </Section>

      <TotalsSection title={hasScreenshot ? "Totals in this screenshot" : "Totals in this entry"} totals={totalsByItem(rows)} />

      {rows.length > 0 && <CharactersSection names={characterNames(rows)} empty="None typed." />}
    </Flex>
  );
}

export interface TryResultProps {
  imageId: string;
  result: ExtractionResult;
  durationMs: number;
  /** The human review of this image's rows; totals and counts read the corrected values. */
  review: ImageReview | undefined;
  dispatch: (action: ReviewAction) => void;
  screenshot: ScreenshotSource | null;
  activeRowId: string | null;
  onActiveRow: (rowId: string | null) => void;
  selection: RowSelection | null;
  /** Character names read anywhere in the batch. */
  characters: readonly string[];
}

export function TryResult({
  imageId,
  result,
  durationMs,
  review,
  dispatch,
  screenshot,
  activeRowId,
  onActiveRow,
  selection,
  characters,
}: TryResultProps) {
  const animate = !useReducedMotion();

  if (!result.looksLikeBankLog) {
    return (
      <Flex direction="column" gap="4">
        <Callout.Root color="amber">
          <Callout.Text weight="medium">This doesn&apos;t look like a guild bank log.</Callout.Text>
          <Callout.Text>
            Open the guild bank, switch to the log, and capture the list of deposit rows.
          </Callout.Text>
        </Callout.Root>
        {result.warnings.length > 1 && (
          <Section title="Warnings">
            <Warnings warnings={result.warnings.slice(1)} />
          </Section>
        )}
        <RunFooter result={result} durationMs={durationMs} />
      </Flex>
    );
  }

  const counts = reviewCounts(review);
  const rows = correctedRows(review);
  const totals = totalsByItem(rows);
  const names = characterNames(rows);
  const changed = counts.edited + counts.added + counts.deleted > 0;

  return (
    <Flex direction="column" gap="5">
      <Section title="Deposit rows">
        <Flex align="center" justify="between" gap="3" wrap="wrap">
          <Flex align="center" gap="2" wrap="wrap">
            <Text size="2" color="gray">
              {counts.rows} {counts.rows === 1 ? "row" : "rows"}
              {counts.edited > 0 ? ` · ${counts.edited} edited` : ""}
              {counts.added > 0 ? ` · ${counts.added} added` : ""}
            </Text>
            <span aria-live="polite">
              <ToCheckBadge rows={counts.rows} toCheck={counts.toCheck} />
            </span>
          </Flex>
          <Flex align="center" gap="2">
            {changed && (
              <Button
                size="1"
                variant="ghost"
                color="gray"
                title="Back to what was read: forgets every edit, added and removed row"
                onClick={() => dispatch({ type: "reset", imageId })}
              >
                Reset
              </Button>
            )}
            <Button
              size="1"
              variant="soft"
              disabled={counts.acceptable === 0}
              title="Checks every row that does not need a closer look. Fragments, silver, unknown and unsure rows stay yours to tap."
              onClick={() => dispatch({ type: "checkAllSafe", imageId })}
            >
              Accept all
            </Button>
          </Flex>
        </Flex>
        {review && (
          <ReviewRows
            imageId={imageId}
            review={review}
            dispatch={dispatch}
            screenshot={screenshot}
            activeRowId={activeRowId}
            onActiveRow={onActiveRow}
            selection={selection}
            characters={characters}
            animate={animate}
          />
        )}
      </Section>

      <TotalsSection title="Totals in this screenshot" totals={totals} />

      <Section title="Warnings">
        <Warnings warnings={result.warnings} />
      </Section>

      <CharactersSection names={names} empty="None read." />

      <RunFooter result={result} durationMs={durationMs} />
    </Flex>
  );
}
