export interface NavEntry {
  href: string;
  label: string;
}

/** Desktop top bar links. Only Progress exists in slice 1; the rest are placeholders. */
export const TOP_NAV: readonly NavEntry[] = [
  { href: "/", label: "Progress" },
  { href: "/contributors", label: "Contributors" },
  { href: "/ledger", label: "Ledger" },
  { href: "/crafts", label: "Crafts" },
  { href: "/audit", label: "Audit" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
