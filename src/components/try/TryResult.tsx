"use client";

import { motion, useReducedMotion } from "motion/react";
import { Badge, Box, Callout, Card, Flex, Grid, Heading, Table, Text, Tooltip } from "@radix-ui/themes";
import { findItem } from "@/catalog";
import { ItemChip, UnknownItemChip } from "@/components/ItemChip";
import { formatQty } from "@/lib/format";
import type { ExtractionResult, ParsedRow } from "@/modules/extractor";
import {
  CONFIDENCE_COLOR,
  confidenceLevel,
  formatConfidence,
  formatQuantity,
  totalsByItem,
} from "@/modules/playground";
import styles from "./TryPlayground.module.css";

const MotionTableRow = motion.create(Table.Row);

const ROW_DURATION = 0.25;
const ROW_STAGGER = 0.04;

/** Rows stagger in; the delay stops growing so a long log does not crawl. */
function rowDelay(index: number): number {
  return Math.min(index, 15) * ROW_STAGGER;
}

function RowItem({ row, qty }: { row: Pick<ParsedRow, "itemId">; qty?: string }) {
  const item = findItem(row.itemId);
  return item ? <ItemChip item={item} qty={qty} /> : <UnknownItemChip qty={qty} />;
}

function ConfidenceBadge({ row }: { row: ParsedRow }) {
  const level = confidenceLevel(row.confidence);
  const badge = (
    <Badge
      color={CONFIDENCE_COLOR[level]}
      variant="soft"
      size="1"
      className={styles.numeric}
      // Focusable so the reason is reachable by keyboard and by tap.
      tabIndex={row.lowConfidenceReason ? 0 : undefined}
    >
      {formatConfidence(row.confidence)}
    </Badge>
  );
  return row.lowConfidenceReason ? <Tooltip content={row.lowConfidenceReason}>{badge}</Tooltip> : badge;
}

/** Class, level and pulse delay for a row; anything below "high" is flagged. */
function flagProps(row: ParsedRow, delay: number, animate: boolean, baseClass: string) {
  const level = confidenceLevel(row.confidence);
  if (level === "high") return { className: baseClass };
  return {
    className: `${baseClass} ${styles.flagged}`,
    "data-level": level,
    // The pulse starts once the row has faded in.
    style: { animationDelay: animate ? `${delay + ROW_DURATION}s` : "0s" },
  };
}

function RowsTable({ rows, animate }: { rows: ParsedRow[]; animate: boolean }) {
  return (
    <Table.Root size="1" variant="surface">
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeaderCell>Item</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">Qty</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Game time</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell>Character</Table.ColumnHeaderCell>
          <Table.ColumnHeaderCell justify="end">Confidence</Table.ColumnHeaderCell>
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {rows.map((row, index) => {
          const delay = rowDelay(index);
          return (
            <MotionTableRow
              key={index}
              align="center"
              initial={animate ? { opacity: 0, y: 6 } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: ROW_DURATION, ease: "easeOut", delay }}
              {...flagProps(row, delay, animate, styles.row)}
            >
              <Table.RowHeaderCell>
                <RowItem row={row} />
                {row.itemId === "unknown" && row.iconDescription && (
                  <Text as="div" size="1" color="gray" mt="1">
                    Looks like: {row.iconDescription}
                  </Text>
                )}
              </Table.RowHeaderCell>
              <Table.Cell justify="end" className={styles.numeric}>
                {formatQuantity(row.quantity)}
              </Table.Cell>
              <Table.Cell className={styles.numeric}>{row.gameTimestamp || "—"}</Table.Cell>
              <Table.Cell>{row.character || "—"}</Table.Cell>
              <Table.Cell justify="end">
                <ConfidenceBadge row={row} />
              </Table.Cell>
            </MotionTableRow>
          );
        })}
      </Table.Body>
    </Table.Root>
  );
}

/** Phones: a list instead of a table (icon · qty · character · timestamp · confidence). */
function RowsList({ rows, animate }: { rows: ParsedRow[]; animate: boolean }) {
  return (
    <Card size="1">
      <Flex direction="column" asChild>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {rows.map((row, index) => {
            const delay = rowDelay(index);
            return (
              <motion.li
                key={index}
                initial={animate ? { opacity: 0, y: 6 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: ROW_DURATION, ease: "easeOut", delay }}
                {...flagProps(row, delay, animate, styles.listRow)}
              >
                <Flex align="center" justify="between" gap="3">
                  <RowItem row={row} />
                  <Text size="2" weight="medium" className={styles.numeric}>
                    {formatQuantity(row.quantity)}
                  </Text>
                </Flex>
                <Flex align="center" justify="between" gap="3" mt="1">
                  <Text size="1" color="gray" truncate>
                    {row.character || "No name"} · {row.gameTimestamp || "no time"}
                  </Text>
                  <ConfidenceBadge row={row} />
                </Flex>
                {row.itemId === "unknown" && row.iconDescription && (
                  <Text as="div" size="1" color="gray" mt="1">
                    Looks like: {row.iconDescription}
                  </Text>
                )}
                {row.lowConfidenceReason && (
                  <Text as="div" size="1" color={CONFIDENCE_COLOR[confidenceLevel(row.confidence)]} mt="1">
                    {row.lowConfidenceReason}
                  </Text>
                )}
              </motion.li>
            );
          })}
        </ul>
      </Flex>
    </Card>
  );
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

export function TryResult({ result, durationMs }: { result: ExtractionResult; durationMs: number }) {
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

  const { rows } = result;
  const needLook = rows.filter((row) => confidenceLevel(row.confidence) !== "high").length;
  const totals = totalsByItem(rows);

  return (
    <Flex direction="column" gap="5">
      <Section title="Deposit rows">
        <Text size="2" color="gray">
          {rows.length} {rows.length === 1 ? "row" : "rows"}
          {needLook > 0 ? ` · ${needLook} to double-check` : ""}
        </Text>
        {rows.length === 0 ? (
          <Card size="2">
            <Text size="2" color="gray">
              No deposit rows were found in this screenshot.
            </Text>
          </Card>
        ) : (
          <>
            <Box display={{ initial: "none", sm: "block" }}>
              <RowsTable rows={rows} animate={animate} />
            </Box>
            <Box display={{ initial: "block", sm: "none" }}>
              <RowsList rows={rows} animate={animate} />
            </Box>
          </>
        )}
      </Section>

      {totals.length > 0 && (
        <Section title="Totals in this screenshot">
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
      )}

      <Section title="Warnings">
        <Warnings warnings={result.warnings} />
      </Section>

      <Section title="Characters">
        {result.characters.length === 0 ? (
          <Text size="2" color="gray">
            None read.
          </Text>
        ) : (
          <Flex gap="2" wrap="wrap">
            {result.characters.map((name) => (
              <Badge key={name} color="gray" variant="surface" size="2">
                {name}
              </Badge>
            ))}
          </Flex>
        )}
      </Section>

      <RunFooter result={result} durationMs={durationMs} />
    </Flex>
  );
}
