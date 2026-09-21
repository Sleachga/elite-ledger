export interface NavEntry {
  href: string;
  label: string;
}

/**
 * Where the Upload button (desktop) and the Upload tab (mobile) go. Until the
 * real upload flow exists they open the `/try` playground; set this back to
 * "/upload" to revert.
 */
export const UPLOAD_HREF = "/try";

/** Desktop top bar links. Only Progress exists in slice 1; the rest are placeholders. */
export const TOP_NAV: readonly NavEntry[] = [
  { href: "/", label: "Progress" },
  { href: "/contributors", label: "Contributors" },
  { href: "/ledger", label: "Ledger" },
  { href: "/crafts", label: "Crafts" },
  { href: "/audit", label: "Audit" },
  { href: "/try", label: "Try" },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
