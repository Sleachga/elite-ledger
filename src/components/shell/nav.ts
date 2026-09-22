export interface NavEntry {
  href: string;
  label: string;
}

/** Where the Upload button (desktop) and the Upload tab (mobile) go. */
export const UPLOAD_HREF = "/upload";

/** The admin area: a small link on the right of the desktop top bar, and an entry on the mobile More page. */
export const ADMIN_HREF = "/admin";

/** Mobile "More": what the bottom tab bar has no room for. */
export const MORE_NAV: readonly (NavEntry & { description: string })[] = [
  { href: "/crafts", label: "Crafts", description: "Every crafted Elite and who received it." },
  { href: "/audit", label: "Audit", description: "Every admin action, public." },
  { href: ADMIN_HREF, label: "Admin", description: "Settings. Passcode needed." },
];

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
