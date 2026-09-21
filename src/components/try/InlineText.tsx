"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Text, TextField } from "@radix-ui/themes";
import styles from "./Review.module.css";

/**
 * A short text (game timestamp, character) that turns into an input when
 * clicked. Enter or leaving the field saves, Esc cancels.
 */
export function InlineText({
  value,
  label,
  placeholder = "—",
  numeric = false,
  display,
  suggestions,
  onSave,
}: {
  value: string;
  /** For screen readers: "Character of row 3". */
  label: string;
  /** Shown when the value is empty. */
  placeholder?: string;
  numeric?: boolean;
  /** A shorter way to show the value while it is not being edited (the full value is the tooltip). */
  display?: (value: string) => string;
  /** Offered while typing (the character names read from the batch). */
  suggestions?: readonly string[];
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  const settled = useRef(false);
  const editing = draft !== null;
  const listId = useId();

  useEffect(() => {
    if (!editing && refocus.current) {
      refocus.current = false;
      trigger.current?.focus();
    }
  }, [editing]);

  function finish(text: string | null, fromKeyboard: boolean) {
    if (settled.current) return;
    settled.current = true;
    refocus.current = fromKeyboard;
    setDraft(null);
    if (text !== null && text.trim() !== value) onSave(text.trim());
  }

  if (editing) {
    return (
      <>
        <TextField.Root
          className={styles.textInput}
          size="1"
          autoComplete="off"
          enterKeyHint="done"
          aria-label={label}
          list={suggestions && suggestions.length > 0 ? listId : undefined}
          value={draft}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={(event) => finish(event.currentTarget.value, false)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              finish(event.currentTarget.value, true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              finish(null, true);
            }
          }}
        />
        {suggestions && suggestions.length > 0 && (
          <datalist id={listId}>
            {suggestions.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
      </>
    );
  }

  return (
    <button
      ref={trigger}
      type="button"
      className={`${styles.editTrigger} ${styles.editStart}`}
      data-placeholder={value === ""}
      aria-label={`${label}: ${value || "empty"}. Edit`}
      title="Click to correct"
      onClick={() => {
        settled.current = false;
        setDraft(value);
      }}
    >
      <Text size="2" className={numeric ? styles.sanity : styles.inlineName} title={value || undefined}>
        {value ? (display ? display(value) : value) : placeholder}
      </Text>
    </button>
  );
}
