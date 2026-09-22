const integer = new Intl.NumberFormat("en-US");

/** 20000n -> "20,000". Works for bigint and number. */
export function formatQty(value: bigint | number): string {
  return integer.format(value);
}

const relative = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const TIME_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 60 * 60 * 1000],
  ["month", 30 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

/**
 * "3 minutes ago", "yesterday", "2 months ago". Anything under a minute
 * (clock skew into the future included) is "just now". Pure: the caller
 * supplies `now`.
 */
export function formatTimeAgo(at: number, now: number): string {
  const elapsed = now - at;
  for (const [unit, ms] of TIME_UNITS) {
    if (elapsed >= ms) return relative.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}

export function formatDecimal(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
