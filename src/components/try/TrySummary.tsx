"use client";

import { Badge, Card, Flex, Grid, Heading, Progress, Text } from "@radix-ui/themes";
import { catalog, findItem } from "@/catalog";
import { ItemChip, UnknownItemChip } from "@/components/ItemChip";
import { CountUp } from "@/components/progress/CountUp";
import { formatQty } from "@/lib/format";
import type { QueueEntry } from "@/modules/playground/queue";
import {
  characterBreakdown,
  combinedTotals,
  finishedResults,
  summarize,
} from "@/modules/playground/summary";
import styles from "./TryPlayground.module.css";

const CATALOG_ORDER = catalog.map((item) => item.id);

/**
 * A BigInt quantity that tweens like the hero numbers. The tween runs on a
 * Number, so a total past 2^53 is printed exactly and simply does not tween.
 */
function CountUpQty({ value }: { value: bigint }) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) return <>{formatQty(value)}</>;
  return <CountUp value={Number(value)} />;
}

function Stat({
  label,
  children,
  hint,
  color,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  color?: "amber" | "red";
  /** Spans both columns of the phone grid. */
  wide?: boolean;
}) {
  return (
    <Card size="1" className={wide ? styles.statWide : undefined}>
      <Flex direction="column" gap="1" minWidth="0">
        <Text size="1" color="gray" weight="medium" className={styles.statLabel}>
          {label}
        </Text>
        <Text size="5" weight="bold" color={color} className={styles.numeric} style={{ lineHeight: 1.15 }}>
          {children}
        </Text>
        {hint}
      </Flex>
    </Card>
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Live summary of the whole batch: counts, combined totals, per-character rows. */
export function TrySummary({ entries }: { entries: readonly QueueEntry[] }) {
  const summary = summarize(entries);
  const results = finishedResults(entries);
  const totals = combinedTotals(results, CATALOG_ORDER);
  const characters = characterBreakdown(results);

  const pending = [
    summary.reading > 0 ? `${summary.reading} reading` : null,
    summary.queued > 0 ? `${summary.queued} queued` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
    summary.canceled > 0 ? `${summary.canceled} canceled` : null,
  ].filter((part): part is string => part !== null);

  return (
    <Flex direction="column" gap="3" asChild>
      <section aria-label="Batch summary">
        <Grid columns={{ initial: "2", sm: "3", md: "5" }} gap="3">
          <Stat
            label="Images read"
            wide
            hint={
              <>
                <Progress
                  size="1"
                  value={summary.total === 0 ? 0 : (summary.settled / summary.total) * 100}
                  aria-label="Images finished"
                />
                <Text size="1" color="gray" aria-live="polite">
                  {pending.length > 0 ? pending.join(" · ") : "All finished"}
                </Text>
              </>
            }
          >
            <CountUp value={summary.done} />
            <Text size="3" color="gray" weight="regular">
              {" "}
              / {summary.total}
            </Text>
          </Stat>
          <Stat label="Deposit rows">
            <CountUp value={summary.rows} />
          </Stat>
          <Stat label="To double-check" color={summary.lowConfidenceRows > 0 ? "amber" : undefined}>
            <CountUp value={summary.lowConfidenceRows} />
          </Stat>
          <Stat label="Warnings" color={summary.warnings > 0 ? "amber" : undefined}>
            <CountUp value={summary.warnings} />
          </Stat>
          <Stat label="Read time">
            <CountUp value={summary.durationMs / 1000} decimals={1} />
            <Text size="3" color="gray" weight="regular">
              {" "}
              s
            </Text>
          </Stat>
        </Grid>

        <Card size="1">
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="2">
              <Heading as="h2" size="2">
                Combined totals
              </Heading>
              {totals.length === 0 ? (
                <Text size="2" color="gray">
                  Totals appear here as screenshots finish.
                </Text>
              ) : (
                <Grid columns={{ initial: "1", sm: "2", md: "3" }} gapX="6" gapY="2">
                  {totals.map((total) => {
                    const item = findItem(total.itemId);
                    return (
                      <Flex key={total.itemId} align="center" justify="between" gap="3" minWidth="0">
                        {item ? <ItemChip item={item} /> : <UnknownItemChip />}
                        <Text size="2" weight="medium" className={styles.numeric}>
                          <CountUpQty value={total.total} />
                          <Text size="1" color="gray" weight="regular">
                            {" "}
                            · {total.rows} {plural(total.rows, "row", "rows")}
                          </Text>
                        </Text>
                      </Flex>
                    );
                  })}
                </Grid>
              )}
            </Flex>

            {characters.length > 0 && (
              <Flex direction="column" gap="2">
                <Heading as="h2" size="2">
                  By character
                </Heading>
                <Flex gap="2" wrap="wrap">
                  {characters.map((entry) => (
                    <Badge key={entry.character} color="gray" variant="surface" size="2" className={styles.characterBadge}>
                      <span className={styles.characterName}>{entry.character || "No name"}</span>
                      <span className={styles.numeric}>
                        {formatQty(entry.rows)} {plural(entry.rows, "row", "rows")}
                        {entry.images > 1 ? ` · ${entry.images} images` : ""}
                      </span>
                    </Badge>
                  ))}
                </Flex>
              </Flex>
            )}
          </Flex>
        </Card>
      </section>
    </Flex>
  );
}
