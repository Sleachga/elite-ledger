"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button, Text, TextField } from "@radix-ui/themes";
import { formatQuantity } from "@/modules/playground";
import { compactReading, parseQuantityInput, quantityRejectionText } from "@/modules/playground/quantity";
import styles from "./Review.module.css";

/**
 * What is typed, as the editor understands it: the formatted value plus a
 * compact reading ("1,500,000,000 · 1.5 billion"), or why it cannot be used.
 */
export function QuantitySanity({ input, id }: { input: string; id?: string }) {
  const parsed = parseQuantityInput(input);
  if (!parsed.ok) {
    return (
      <Text as="div" id={id} size="1" color={parsed.reason === "empty" ? "gray" : "red"} className={styles.sanity}>
        {quantityRejectionText(parsed.reason)}
      </Text>
    );
  }
  const compact = compactReading(parsed.digits);
  const formatted = formatQuantity(parsed.digits);
  return (
    <Text as="div" id={id} size="1" color="gray" className={styles.sanity}>
      {formatted}
      {compact !== parsed.digits ? ` · ${compact}` : ""}
    </Text>
  );
}

/** k / m / b for phones: the decimal keypad has no letters. Must not take focus from the input. */
export function SuffixKeys({ onPick }: { onPick: (suffix: string) => void }) {
  return (
    <span className={styles.suffixKeys}>
      {["k", "m", "b"].map((suffix) => (
        <Button
          key={suffix}
          type="button"
          size="1"
          variant="soft"
          color="gray"
          tabIndex={-1}
          aria-label={suffix === "k" ? "thousand" : suffix === "m" ? "million" : "billion"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPick(suffix)}
        >
          {suffix}
        </Button>
      ))}
    </span>
  );
}

/** Put a k / m / b suffix at the end of what is typed, replacing one that is already there. */
export function withSuffix(text: string, suffix: string): string {
  return `${text.trim().replace(/[kmb]$/i, "")}${suffix}`;
}

/**
 * A quantity that turns into an input when clicked. Accepts "500,000,000",
 * "500m", "1.5b"; Enter or leaving the field saves, Esc cancels. Shows the
 * compact reading for Silver Coin (`alwaysCompact`) and, once corrected, what
 * the extractor had read.
 */
export function QuantityEditor({
  value,
  readAs,
  alwaysCompact = false,
  align = "end",
  suffixKeys = false,
  label,
  onSave,
}: {
  /** Digit string. */
  value: string;
  /** The extracted quantity, when the current one is a correction of it. */
  readAs?: string | null;
  alwaysCompact?: boolean;
  align?: "start" | "end";
  /** Show k / m / b buttons under the input (phones). */
  suffixKeys?: boolean;
  /** For screen readers: "Quantity of Gold Ingot". */
  label: string;
  onSave: (digits: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  /** The edit is over (saved or canceled): the blur of the disappearing input must not save again. */
  const settled = useRef(false);
  const editing = draft !== null;

  // Back to the number once the input is gone, so the keyboard keeps its place.
  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [editing]);

  function commit(text: string, fromKeyboard: boolean) {
    if (settled.current) return;
    const parsed = parseQuantityInput(text);
    if (!parsed.ok) {
      // Enter on something unusable keeps the field open; leaving the field gives up.
      if (!fromKeyboard) {
        settled.current = true;
        setDraft(null);
      }
      return;
    }
    settled.current = true;
    refocus.current = fromKeyboard;
    setDraft(null);
    if (parsed.digits !== value) onSave(parsed.digits);
  }

  const compact = compactReading(value);
  const sanityId = useId();

  return (
    <span className={styles.qty} data-align={align}>
      {editing ? (
        <>
          <TextField.Root
            className={styles.qtyInput}
            size="1"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="done"
            aria-label={label}
            aria-describedby={sanityId}
            aria-invalid={!parseQuantityInput(draft).ok || undefined}
            value={draft}
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={(event) => commit(event.currentTarget.value, false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit(event.currentTarget.value, true);
              } else if (event.key === "Escape") {
                // Cancel the edit only; a sheet or popover around it stays open.
                event.preventDefault();
                event.stopPropagation();
                settled.current = true;
                refocus.current = true;
                setDraft(null);
              }
            }}
          />
          <QuantitySanity input={draft} id={sanityId} />
          {suffixKeys && <SuffixKeys onPick={(suffix) => setDraft((current) => withSuffix(current ?? "", suffix))} />}
        </>
      ) : (
        <>
          <button
            ref={trigger}
            type="button"
            className={`${styles.editTrigger} ${align === "end" ? styles.editEnd : styles.editStart}`}
            aria-label={`${label}: ${formatQuantity(value)}. Edit`}
            title="Click to correct"
            onClick={() => {
              settled.current = false;
              setDraft(formatQuantity(value));
            }}
          >
            <Text size="2" weight="medium" className={styles.sanity}>
              {formatQuantity(value)}
            </Text>
          </button>
          {alwaysCompact && compact !== value && (
            <Text as="div" size="1" color="amber" className={styles.sanity}>
              {compact}
            </Text>
          )}
          {readAs && readAs !== value && (
            <Text as="div" size="1" className={`${styles.sanity} ${styles.wasRead}`}>
              read as {formatQuantity(readAs)}
            </Text>
          )}
        </>
      )}
    </span>
  );
}
