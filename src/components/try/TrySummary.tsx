"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Callout, Card, Flex, Grid, Heading, Link, Progress, Text } from "@radix-ui/themes";
import { catalog, findItem } from "@/catalog";
import { ItemChip, UnknownItemChip } from "@/components/ItemChip";
import { CountUp } from "@/components/progress/CountUp";
import { formatQty } from "@/lib/format";
import { batchCounts, reviewedImages, type UploadStep } from "@/modules/playground/batch";
import { buildTsv } from "@/modules/playground/export";
import type { QueueEntry } from "@/modules/playground/queue";
import type { ReviewState } from "@/modules/playground/review";
import { combinedTotals, summarize, type CharacterTotal } from "@/modules/playground/summary";
import { copyText } from "./clipboard";
import type { SubmitOutcome } from "./submit";
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
  onClick,
  title,
}: {
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
  color?: "amber" | "red" | "green";
  /** Spans both columns of the phone grid. */
  wide?: boolean;
  /** Makes the tile a button. */
  onClick?: () => void;
  title?: string;
}) {
  const inner = (
    <Flex direction="column" gap="1" minWidth="0">
      <Text size="1" color="gray" weight="medium" className={styles.statLabel}>
        {label}
      </Text>
      <Text size="5" weight="bold" color={color} className={styles.numeric} style={{ lineHeight: 1.15 }}>
        {children}
      </Text>
      {hint}
    </Flex>
  );
  if (onClick) {
    return (
      <Card size="1" asChild className={wide ? styles.statWide : undefined}>
        <button type="button" className={styles.statButton} onClick={onClick} title={title}>
          {inner}
        </button>
      </Card>
    );
  }
  return (
    <Card size="1" className={wide ? styles.statWide : undefined}>
      {inner}
    </Card>
  );
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** "Copy rows": the corrected rows in scope as TSV, with an inline "Copied" for two seconds. */
function CopyRows({ tsv, rows, suffix, label }: { tsv: () => string; rows: number; suffix?: string; label?: string }) {
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
        : (label ?? `Copy ${formatQty(rows)} ${plural(rows, "row", "rows")}`) + (suffix ? ` · ${suffix}` : "");

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

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

function characterLabel(character: string): string {
  return character || "No name";
}

export interface TrySummaryProps {
  entries: readonly QueueEntry[];
  review: ReviewState;
  /** Rows per character across the batch, from the corrected rows. */
  characterTotals: readonly CharacterTotal[];
  /** The "By character" filter. */
  character: string | null;
  step: UploadStep;
  confirmed: boolean;
  /** How the last Confirm went. */
  submitOutcome: SubmitOutcome | null;
  sheetUrl?: string;
  onFilterCharacter: (character: string | null) => void;
  /** Open the checker on the first image that needs a look. */
  onCheck: () => void;
  onConfirm: () => void;
  onNewBatch: () => void;
}

/**
 * Live summary of the whole batch: counts, combined totals, per-character rows,
 * and the Confirm step. Everything row-shaped reads the corrected rows (edits
 * in, deleted rows out), within the character filter.
 */
export function TrySummary({
  entries,
  review,
  characterTotals,
  character,
  step,
  confirmed,
  submitOutcome,
  sheetUrl,
  onFilterCharacter,
  onCheck,
  onConfirm,
  onNewBatch,
}: TrySummaryProps) {
  const summary = summarize(entries);
  const images = reviewedImages(entries, review, character);
  const totals = combinedTotals(images, CATALOG_ORDER);
  const counts = batchCounts(entries, review, character);
  const allRows = characterTotals.reduce((sum, total) => sum + total.rows, 0);
  const scopeText = character === null ? undefined : characterLabel(character);

  // A batch typed entirely by hand has nothing to read: no read progress, warnings or read time to show.
  const manualOnly = summary.total > 0 && summary.ready === summary.total;
  const finished = summary.done + summary.ready;
  const reading = summary.reading + summary.queued;

  const pending = [
    summary.reading > 0 ? `${summary.reading} reading` : null,
    summary.queued > 0 ? `${summary.queued} queued` : null,
    summary.failed > 0 ? `${summary.failed} failed` : null,
    summary.canceled > 0 ? `${summary.canceled} canceled` : null,
  ].filter((part): part is string => part !== null);

  const sheetLink = sheetUrl ? (
    <Link href={sheetUrl} target="_blank" rel="noreferrer">
      the guild sheet
    </Link>
  ) : (
    "the guild sheet"
  );

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
          <Stat label="Deposit rows" hint={scopeText && <Text size="1" color="gray">{scopeText} only</Text>}>
            <CountUp value={counts.rows} />
          </Stat>
          {counts.rows > 0 && counts.toCheck === 0 ? (
            <Stat label="To check" color="green" onClick={onCheck} title="Open the checker">
              <span aria-live="polite">All checked</span>
            </Stat>
          ) : (
            <Stat
              label="To check"
              color={counts.toCheck > 0 ? "amber" : undefined}
              onClick={counts.toCheck > 0 ? onCheck : undefined}
              title={counts.toCheck > 0 ? "Open the checker on the first row that needs a look" : undefined}
              hint={counts.toCheck > 0 && <Text size="1" color="amber">Open the checker →</Text>}
            >
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
            {characterTotals.length > 0 && (
              <Flex direction="column" gap="2">
                <Flex align="center" gap="2" wrap="wrap">
                  <Heading as="h2" size="2">
                    By character
                  </Heading>
                  <Text size="1" color="gray">
                    {character === null ? "Pick one to check and copy only that character's rows." : `Showing ${scopeText} only.`}
                  </Text>
                </Flex>
                <Flex gap="2" wrap="wrap" role="group" aria-label="Filter by character">
                  <button
                    type="button"
                    className={styles.chip}
                    aria-pressed={character === null}
                    onClick={() => onFilterCharacter(null)}
                  >
                    <span className={styles.characterName}>All</span>
                    <span className={styles.numeric}>
                      {formatQty(allRows)} {plural(allRows, "row", "rows")}
                    </span>
                  </button>
                  {characterTotals.map((total) => (
                    <button
                      key={total.character}
                      type="button"
                      className={styles.chip}
                      aria-pressed={character === total.character}
                      title={
                        character === total.character
                          ? "Show every character again"
                          : `Show only ${characterLabel(total.character)}'s rows`
                      }
                      onClick={() => onFilterCharacter(character === total.character ? null : total.character)}
                    >
                      <span className={styles.characterName}>{characterLabel(total.character)}</span>
                      <span className={styles.numeric}>
                        {formatQty(total.rows)} {plural(total.rows, "row", "rows")}
                        {total.images > 1 ? ` · ${total.images} images` : ""}
                      </span>
                    </button>
                  ))}
                </Flex>
              </Flex>
            )}

            <Flex direction="column" gap="2">
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <Heading as="h2" size="2">
                  Combined totals
                </Heading>
                <CopyRows rows={counts.rows} suffix={scopeText} tsv={() => buildTsv(images)} />
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
          </Flex>
        </Card>

        {step !== "upload" && (
          <Card size="2" id="upload-confirm" className={styles.confirmCard} data-ready={step === "confirm"}>
            {confirmed ? (
              <Flex direction="column" gap="3">
                <Callout.Root color="green" role="status">
                  <Callout.Text weight="medium">
                    <CheckIcon />{" "}
                    {submitOutcome?.kind === "copy_failed"
                      ? `Confirmed — but the ${formatQty(submitOutcome.rows)} rows could not be copied.`
                      : `Confirmed — ${formatQty(submitOutcome?.rows ?? counts.rows)} rows copied.`}
                  </Callout.Text>
                  <Callout.Text>
                    {submitOutcome?.kind === "copy_failed" ? (
                      <>Press Copy rows, then paste them into the Ledger tab of {sheetLink}.</>
                    ) : (
                      <>Paste them into the Ledger tab of {sheetLink}.</>
                    )}
                  </Callout.Text>
                </Callout.Root>
                <Flex gap="2" wrap="wrap">
                  <CopyRows rows={counts.rows} suffix={scopeText} label="Copy rows again" tsv={() => buildTsv(images)} />
                  <Button size="1" variant="soft" color="gray" onClick={onNewBatch}>
                    Start a new batch
                  </Button>
                </Flex>
              </Flex>
            ) : (
              <Flex align="center" justify="between" gap="3" wrap="wrap">
                <Flex direction="column" gap="1" minWidth="0">
                  <Heading as="h2" size="3">
                    Confirm
                  </Heading>
                  {step === "confirm" ? (
                    <Text size="2" color="gray">
                      {counts.rows === 0
                        ? "No deposit rows to confirm."
                        : `Every row is checked: ${formatQty(counts.rows)} ${plural(counts.rows, "row", "rows")}${
                            scopeText ? ` for ${scopeText}` : ` from ${characterTotals.length} ${plural(characterTotals.length, "character", "characters")}`
                          }${summary.warnings > 0 ? ` · ${summary.warnings} ${plural(summary.warnings, "warning", "warnings")}` : ""}. Confirming copies them for the guild sheet.`}
                    </Text>
                  ) : (
                    <Flex align="center" gap="2" wrap="wrap">
                      {counts.toCheck > 0 && (
                        <Badge color="amber" variant="soft" size="2" className={styles.numeric}>
                          {formatQty(counts.toCheck)} {plural(counts.toCheck, "row", "rows")} still {counts.toCheck === 1 ? "needs" : "need"} a check
                        </Badge>
                      )}
                      {reading > 0 && (
                        <Text size="2" color="gray">
                          {reading} {plural(reading, "image", "images")} still reading.
                        </Text>
                      )}
                      {counts.toCheck > 0 && (
                        <Button size="1" variant="soft" onClick={onCheck}>
                          Check rows
                        </Button>
                      )}
                    </Flex>
                  )}
                </Flex>
                <Button size="3" disabled={step !== "confirm" || counts.rows === 0} onClick={onConfirm}>
                  Confirm {formatQty(counts.rows)} {plural(counts.rows, "row", "rows")}
                  {scopeText ? ` · ${scopeText}` : ""}
                </Button>
              </Flex>
            )}
          </Card>
        )}
      </section>
    </Flex>
  );
}
