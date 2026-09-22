/**
 * Upload modes on `/try`: "manual" (the member types the rows; nothing is sent
 * anywhere) and "ai" (the screenshot is read by the extractor). Which modes are
 * on offer comes from the server (`GET /api/try-extract`, fed by the admin
 * settings); which one is active is the member's own, remembered choice.
 * Pure and browser-safe: the component does the fetch and the storage.
 */
import type { UploadMode } from "@/modules/settings";

export type { UploadMode };

export const UPLOAD_MODE_STORAGE_KEY = "elite-ledger:upload-mode";

export const MODE_LABEL: Record<UploadMode, string> = {
  manual: "Manual",
  ai: "AI-assisted",
};

/** The parts of the status answer that decide the modes. */
export interface ModeStatus {
  /** false: the endpoint is off on this deployment (no `TRY_PASSCODE`). */
  enabled: boolean;
  /** false: an admin switched AI reading off. */
  aiEnabled: boolean;
  defaultMode: UploadMode;
}

/** What to assume when the server could not be asked: today's behaviour. The first POST says what is wrong. */
export const FALLBACK_MODE_STATUS: ModeStatus = { enabled: true, aiEnabled: true, defaultMode: "ai" };

export function isUploadMode(value: unknown): value is UploadMode {
  return value === "manual" || value === "ai";
}

/** A status answer from an older server has no mode fields: they read as the defaults. */
export function modeStatusOf(body: Partial<ModeStatus> | null | undefined): ModeStatus {
  return {
    enabled: typeof body?.enabled === "boolean" ? body.enabled : FALLBACK_MODE_STATUS.enabled,
    aiEnabled: typeof body?.aiEnabled === "boolean" ? body.aiEnabled : FALLBACK_MODE_STATUS.aiEnabled,
    defaultMode: isUploadMode(body?.defaultMode) ? body.defaultMode : FALLBACK_MODE_STATUS.defaultMode,
  };
}

export function aiAvailable(status: ModeStatus): boolean {
  return status.enabled && status.aiEnabled;
}

/** Manual needs no server, so it is always there. With one mode only, the page hides the control. */
export function availableModes(status: ModeStatus): UploadMode[] {
  return aiAvailable(status) ? ["manual", "ai"] : ["manual"];
}

/**
 * The active mode: the member's remembered choice if it is still on offer,
 * else the admin's default, else whatever is left (a remembered or default
 * "ai" is ignored while AI is off).
 */
export function resolveMode(status: ModeStatus, remembered: unknown): UploadMode {
  const modes = availableModes(status);
  if (isUploadMode(remembered) && modes.includes(remembered)) return remembered;
  return modes.includes(status.defaultMode) ? status.defaultMode : modes[0];
}

/** The one line shown instead of the control when manual is the only mode; null when both are on offer. */
export function singleModeNote(status: ModeStatus): string | null {
  if (aiAvailable(status)) return null;
  return status.aiEnabled
    ? "AI reading is not set up on this deployment — add rows by hand."
    : "AI reading is switched off by an admin — add rows by hand.";
}
