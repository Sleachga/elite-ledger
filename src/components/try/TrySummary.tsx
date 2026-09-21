"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, Flex, Grid, Heading, Progress, Text } from "@radix-ui/themes";
import { catalog, findItem } from "@/catalog";
import { ItemChip, UnknownItemChip } from "@/components/ItemChip";
import { CountUp } from "@/components/progress/CountUp";
import { formatQty } from "@/lib/format";
import { reviewedImages } from "@/modules/playground/batch";
import { buildTsv } from "@/modules/playground/export";
import type { QueueEntry } from "@/modules/playground/queue";
import { batchReviewCounts, type ReviewState } from "@/modules/playground/review";
import { characterBreakdown, combinedTotals, summarize } from "@/modules/playground/summary";
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
  color?: "amber" | "red" | "green";
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

/** Clipboard API where there is one (https, localhost); the old textarea trick elsewhere (a phone on the LAN). */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permission refused: try the fallback.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** "Copy rows": the corrected rows of the whole batch as TSV, with an inline "Copied" for two seconds. */
function CopyRows({ tsv, rows }: { tsv: () => string; rows: number }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const id = window.setTimeout(() => setState("idle"), 2000);
    return () => window.clearTimeout(id);
  }, [state]);

  const text =
    state === "copied"
      ? "Copied"
      : state === "failed"
        ? "Copy failed"
        : `Copy ${formatQty(rows)} ${plural(rows, "row", "rows")}`;

  return (
    <Button
      size="1"
      variant="soft"
      color={state === "copied" ? "green" : state === "failed" ? "red" : undefined}
      disabled={rows === 0}
      title="Tab-separated, ready to paste into a spreadsheet: game time, character, item, quantity, image"
      onClick={async () => setState((await copyText(tsv())) ? "copied" : "failed")}
    >
      <span aria-live="polite">{text}</span>
    </Button>
  );
}

/**
 * Live summary of the whole batch: counts, combined totals, per-character rows.
 * Everything row-shaped reads the corrected rows (edits in, deleted rows out).
 */
export function TrySummary({ entries, review }: { entries: readonly QueueEntry[]; review: ReviewState }) {
  const summary = summarize(entries);
  const images = reviewedImages(entries, review);
  const totals = combinedTotals(images, CATALOG_ORDER);
  const characters = characterBreakdown(images);
  const counts = batchReviewCounts(
    images.map((image) => (image.looksLikeBankLog ? review[image.imageId] : undefined)),
  );

  // A batch typed entirely by hand has nothing to read: no read progress, warnings or read time to show.
  const manualOnly = summary.total > 0 && summary.ready === summary.total;
  const finished = summary.done + summary.ready;

  const pending = [
    summary.reading > 0 ? `${summary.reading} reading` : null,
    summary.queued > 0 ? `${summary.queued} queued` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
    summary.canceled > 0 ? `${summary.canceled} canceled` : null,
  ].filter((part): part is string => part !== null);

  return (
    <Flex direction="column" gap="3" asChild>
      <section aria-label="Batch summary">
        <Grid columns={manualOnly ? { initial: "2", sm: "3" } : { initial: "2", sm: "3", md: "5" }} gap="3">
          <Stat
            label={manualOnly ? "Manual entries" : summary.ready > 0 ? "Images ready" : "Images read"}
            wide
            hint={
              <>
                <Progress
                  size="1"
                  value={summary.total === 0 ? 0 : (summary.settled / summary.total) * 100}
                  aria-label="Images finished"
                />
                <Text size="1" color="gray" aria-live="polite">
                  {manualOnly ? "Rows added by hand" : pending.length > 0 ? pending.join(" · ") : "All finished"}
                </Text>
              </>
            }
          >
            <CountUp value={finished} />
            <Text size="3" color="gray" weight="regular">
              {" "}
              / {summary.total}
            </Text>
          </Stat>
          <Stat label="Deposit rows">
            <CountUp value={counts.rows} />
          </Stat>
          {counts.rows > 0 && counts.toCheck === 0 ? (
            <Stat label="To check" color="green">
              <span aria-live="polite">All checked</span>
            </Stat>
          ) : (
            <Stat label="To check" color={counts.toCheck > 0 ? "amber" : undefined}>
              <span aria-live="polite">
                <CountUp value={counts.toCheck} />
              </span>
            </Stat>
          )}
          {!manualOnly && (
            <>
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
            </>
          )}
        </Grid>

        <Card size="1">
          <Flex direction="column" gap="3">
            <Flex direction="column" gap="2">
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <Heading as="h2" size="2">
                  Combined totals
                </Heading>
                <CopyRows rows={counts.rows} tsv={() => buildTsv(images)} />
              </Flex>
              {totals.length === 0 ? (
                <Text size="2" color="gray">
                  {manualOnly ? "Totals appear here as you add rows." : "Totals appear here as screenshots finish."}
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
