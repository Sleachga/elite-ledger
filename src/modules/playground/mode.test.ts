import { describe, expect, it } from "vitest";
import { errorText } from "./index";
import {
  FALLBACK_MODE_STATUS,
  aiAvailable,
  availableModes,
  isUploadMode,
  modeStatusOf,
  resolveMode,
  singleModeNote,
  type ModeStatus,
} from "./mode";

const BOTH: ModeStatus = { enabled: true, aiEnabled: true, defaultMode: "ai" };
const AI_OFF: ModeStatus = { enabled: true, aiEnabled: false, defaultMode: "ai" };
const NOT_DEPLOYED: ModeStatus = { enabled: false, aiEnabled: true, defaultMode: "ai" };

describe("availableModes", () => {
  it("offers both while AI reading is on", () => {
    expect(availableModes(BOTH)).toEqual(["manual", "ai"]);
    expect(aiAvailable(BOTH)).toBe(true);
  });

  it("offers manual only when an admin switched AI off, or the endpoint is off on this deployment", () => {
    expect(availableModes(AI_OFF)).toEqual(["manual"]);
    expect(availableModes(NOT_DEPLOYED)).toEqual(["manual"]);
    expect(availableModes({ ...AI_OFF, enabled: false })).toEqual(["manual"]);
  });
});

describe("resolveMode", () => {
  it("falls back to the admin's default when nothing is remembered", () => {
    expect(resolveMode(BOTH, null)).toBe("ai");
    expect(resolveMode({ ...BOTH, defaultMode: "manual" }, null)).toBe("manual");
  });

  it("prefers the member's remembered choice", () => {
    expect(resolveMode(BOTH, "manual")).toBe("manual");
    expect(resolveMode({ ...BOTH, defaultMode: "manual" }, "ai")).toBe("ai");
  });

  it("ignores a remembered or default \"ai\" while AI is off", () => {
    expect(resolveMode(AI_OFF, "ai")).toBe("manual");
    expect(resolveMode(AI_OFF, null)).toBe("manual");
    expect(resolveMode(NOT_DEPLOYED, "ai")).toBe("manual");
  });

  it("ignores junk in storage", () => {
    for (const junk of ["", "AI", "auto", 1, {}, undefined]) {
      expect(resolveMode(BOTH, junk)).toBe("ai");
    }
    expect(isUploadMode("manual")).toBe(true);
    expect(isUploadMode("Manual")).toBe(false);
  });
});

describe("singleModeNote", () => {
  it("is null while the control is shown", () => {
    expect(singleModeNote(BOTH)).toBeNull();
  });

  it("says who switched AI off", () => {
    expect(singleModeNote(AI_OFF)).toBe("AI reading is switched off by an admin — add rows by hand.");
    expect(singleModeNote(NOT_DEPLOYED)).toContain("not set up on this deployment");
  });
});

describe("modeStatusOf", () => {
  it("reads the status answer", () => {
    expect(modeStatusOf({ enabled: true, aiEnabled: false, defaultMode: "manual" })).toEqual({
      enabled: true,
      aiEnabled: false,
      defaultMode: "manual",
    });
  });

  it("fills in today's behaviour for anything missing or malformed", () => {
    expect(modeStatusOf(null)).toEqual(FALLBACK_MODE_STATUS);
    expect(modeStatusOf({ enabled: false })).toEqual({ enabled: false, aiEnabled: true, defaultMode: "ai" });
    expect(modeStatusOf({ defaultMode: "auto" as never, aiEnabled: "no" as never })).toEqual(FALLBACK_MODE_STATUS);
  });
});

describe("errorText", () => {
  it("has a plain message for ai_disabled", () => {
    expect(errorText("ai_disabled")).toBe("AI reading is switched off by an admin. Add rows by hand.");
  });
});
