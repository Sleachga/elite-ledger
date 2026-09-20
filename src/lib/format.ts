const integer = new Intl.NumberFormat("en-US");

/** 20000n -> "20,000". Works for bigint and number. */
export function formatQty(value: bigint | number): string {
  return integer.format(value);
}

export function formatDecimal(value: number, decimals: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}
