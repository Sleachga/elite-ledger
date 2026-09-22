import { describe, expect, it } from "vitest";
import { formatTimeAgo } from "./format";

const NOW = Date.UTC(2026, 8, 20, 12, 0, 0);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatTimeAgo", () => {
  it("says \"just now\" under a minute, and for a clock that runs ahead", () => {
    expect(formatTimeAgo(NOW, NOW)).toBe("just now");
    expect(formatTimeAgo(NOW - 59_000, NOW)).toBe("just now");
    expect(formatTimeAgo(NOW + 5 * MINUTE, NOW)).toBe("just now");
  });

  it("counts whole minutes, hours and days", () => {
    expect(formatTimeAgo(NOW - MINUTE, NOW)).toBe("1 minute ago");
    expect(formatTimeAgo(NOW - 59 * MINUTE, NOW)).toBe("59 minutes ago");
    expect(formatTimeAgo(NOW - 3 * HOUR, NOW)).toBe("3 hours ago");
    expect(formatTimeAgo(NOW - DAY, NOW)).toBe("yesterday");
    expect(formatTimeAgo(NOW - 6 * DAY, NOW)).toBe("6 days ago");
  });

  it("goes on to months and years", () => {
    expect(formatTimeAgo(NOW - 65 * DAY, NOW)).toBe("2 months ago");
    expect(formatTimeAgo(NOW - 800 * DAY, NOW)).toBe("2 years ago");
  });
});
