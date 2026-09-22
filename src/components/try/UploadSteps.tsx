"use client";

import { Text } from "@radix-ui/themes";
import { UPLOAD_STEPS, type UploadStep } from "@/modules/playground/batch";
import styles from "./TryPlayground.module.css";

const LABEL: Record<UploadStep, string> = { upload: "Upload", check: "Check", confirm: "Confirm" };

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * The flow in three steps, Upload → Check → Confirm, with the current one lit.
 * "Check" is a button while there are rows to open the checker on.
 */
export function UploadSteps({
  step,
  detail,
  onCheck,
}: {
  step: UploadStep;
  /** One line under the steps: what is happening, or what to do next. */
  detail?: string | null;
  /** Opens the check dialog; absent while there is nothing to check yet. */
  onCheck?: (() => void) | null;
}) {
  const current = UPLOAD_STEPS.indexOf(step);
  return (
    <nav aria-label="Steps" className={styles.stepsNav}>
      <ol className={styles.steps}>
        {UPLOAD_STEPS.map((name, index) => {
          const state = index < current ? "done" : index === current ? "current" : "todo";
          const content = (
            <>
              <span className={styles.stepMark} aria-hidden>
                {state === "done" ? <CheckIcon /> : index + 1}
              </span>
              <span>{LABEL[name]}</span>
            </>
          );
          return (
            <li
              key={name}
              className={styles.step}
              data-state={state}
              aria-current={state === "current" ? "step" : undefined}
            >
              {name === "check" && onCheck ? (
                <button type="button" className={styles.stepButton} onClick={onCheck} title="Open the checker">
                  {content}
                </button>
              ) : (
                <span className={styles.stepButton}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
      {detail && (
        <Text size="1" color="gray" aria-live="polite">
          {detail}
        </Text>
      )}
    </nav>
  );
}
