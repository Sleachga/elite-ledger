/**
 * Quantities typed by a human on the verify rows: "500,000,000", "500 000 000",
 * "500m", "1.5b". Pure and browser-safe. Everything stays a digit string and
 * goes through BigInt, never Number: Silver Coin amounts pass 2^53.
 */

/** Postgres BIGINT holds 19 digits; 18 keeps every accepted value inside it. */
export const MAX_QUANTITY_DIGITS = 18;

export type QuantityRejection = "empty" | "invalid" | "negative" | "zero" | "fraction" | "too_long";

export type QuantityParse = { ok: true; digits: string } | { ok: false; reason: QuantityRejection };

const SUFFIX_ZEROS: Record<string, number> = { k: 3, m: 6, b: 9 };

/** "1,500" / "1 500" / "1'500" / "1_500": one separator kind, groups of three. */
const GROUPED = /^\d{1,3}(?:([,'’_\s])\d{3})(?:\1\d{3})*$/;
/** "1.500.000": dots as grouping, only without a suffix. */
const DOT_GROUPED = /^\d{1,3}(?:\.\d{3})+$/;

/** The integer part as plain digits, or null when its grouping is malformed ("50,000,00"). */
function ungroup(part: string): string | null {
  if (/^\d*$/.test(part)) return part;
  return GROUPED.test(part) ? part.replace(/\D/g, "") : null;
}

/**
 * What a typed quantity means, as a positive integer digit string.
 *
 * - separators: commas, spaces, apostrophes, underscores; dots too when there
 *   is no suffix ("1.500.000"). Groups must be well formed: a slipped digit
 *   ("50,000,00") is rejected rather than guessed at.
 * - suffixes k / m / b, where a dot is the decimal point: "1.5b".
 * - rejected: nothing, negatives, zero, a fraction that is not a whole number
 *   ("1.5", "1.2345k"), more than 18 digits.
 */
export function parseQuantityInput(input: string): QuantityParse {
  let text = input.trim().toLowerCase();
  if (text === "") return { ok: false, reason: "empty" };
  if (/^[-−–]/.test(text)) return { ok: false, reason: "negative" };
  if (text.startsWith("+")) text = text.slice(1).trim();

  let zeros = 0;
  const last = text.at(-1) ?? "";
  if (last in SUFFIX_ZEROS) {
    zeros = SUFFIX_ZEROS[last];
    text = text.slice(0, -1).trim();
  }

  let whole: string;
  let fraction = "";
  if (zeros === 0 && DOT_GROUPED.test(text)) {
    whole = text.replaceAll(".", "");
  } else {
    const parts = text.split(".");
    if (parts.length > 2) return { ok: false, reason: "invalid" };
    const ungrouped = ungroup(parts[0]);
    if (ungrouped === null) return { ok: false, reason: "invalid" };
    whole = ungrouped;
    fraction = parts[1] ?? "";
    if (!/^\d*$/.test(fraction)) return { ok: false, reason: "invalid" };
  }
  if (whole === "" && fraction === "") return { ok: false, reason: "invalid" };

  fraction = fraction.replace(/0+$/, "");
  if (fraction.length > zeros) return { ok: false, reason: "fraction" };

  const digits = (whole + fraction.padEnd(zeros, "0")).replace(/^0+/, "");
  if (digits === "") return { ok: false, reason: "zero" };
  if (digits.length > MAX_QUANTITY_DIGITS) return { ok: false, reason: "too_long" };
  return { ok: true, digits };
}

const REJECTION_TEXT: Record<QuantityRejection, string> = {
  empty: "Type a number.",
  invalid: "Not a number. Try 500,000,000 or 500m.",
  negative: "Deposits are never negative.",
  zero: "A deposit is at least 1.",
  fraction: "That is not a whole number.",
  too_long: `Too large: ${MAX_QUANTITY_DIGITS} digits at most.`,
};

export function quantityRejectionText(reason: QuantityRejection): string {
  return REJECTION_TEXT[reason];
}

const UNITS = ["", "thousand", "million", "billion", "trillion", "quadrillion", "quintillion"];

/**
 * A quantity the way a person says it: "1500000000" -> "1.5 billion",
 * "640" -> "640". At most two decimals, cut (never rounded up) with a leading
 * "≈" when digits were dropped, so "999,999" never reads as "1 million".
 * Anything that is not all digits comes back as "".
 */
export function compactReading(digits: string): string {
  if (!/^\d+$/.test(digits)) return "";
  const plain = digits.replace(/^0+(?=\d)/, "");
  const unitIndex = Math.min(Math.floor((plain.length - 1) / 3), UNITS.length - 1);
  if (unitIndex === 0) return plain;

  const cut = plain.length - unitIndex * 3;
  const whole = BigInt(plain.slice(0, cut)).toLocaleString("en-US");
  const rest = plain.slice(cut);
  const decimals = rest.slice(0, 2).replace(/0+$/, "");
  const exact = /^0*$/.test(rest.slice(2));
  return `${exact ? "" : "≈ "}${whole}${decimals ? `.${decimals}` : ""} ${UNITS[unitIndex]}`;
}
