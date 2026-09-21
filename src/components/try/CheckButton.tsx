"use client";

import styles from "./Review.module.css";

export type CheckState = "unchecked" | "auto" | "checked";

/**
 * The round check of a review row: amber ring (waiting for a person) → green
 * and filled (checked); a quiet grey tick for rows that started accepted.
 * A real button: Space and Enter toggle it. `data-row-check` is what the rows'
 * arrow-key navigation looks for.
 */
export function CheckButton({
  state,
  label,
  dense = false,
  onToggle,
}: {
  state: CheckState;
  /** What the row is, for screen readers: "Gold Ingot, 112". */
  label: string;
  /** Desktop table: 28px instead of the 40px touch target. */
  dense?: boolean;
  onToggle: () => void;
}) {
  const stateText =
    state === "checked" ? "checked" : state === "auto" ? "accepted automatically" : "needs your check";
  return (
    <button
      type="button"
      className={styles.check}
      data-state={state}
      data-dense={dense}
      data-row-check=""
      aria-pressed={state !== "unchecked"}
      aria-label={`${label}: ${stateText}`}
      title={state === "unchecked" ? "Mark as checked" : state === "auto" ? "Accepted automatically" : "Checked"}
      onClick={onToggle}
    >
      <span className={styles.checkMark} aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
    </button>
  );
}
