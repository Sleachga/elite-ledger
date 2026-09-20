"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Flex, Text } from "@radix-ui/themes";
import { isActivePath } from "./nav";
import { NavIcon, type NavIconName } from "./NavIcons";

interface Tab {
  href: string;
  label: string;
  icon: NavIconName;
  primary?: boolean;
}

const TABS: readonly Tab[] = [
  { href: "/", label: "Progress", icon: "progress" },
  { href: "/contributors", label: "Contributors", icon: "people" },
  { href: "/upload", label: "Upload", icon: "upload", primary: true },
  { href: "/ledger", label: "Ledger", icon: "ledger" },
  { href: "/more", label: "More", icon: "more" },
];

/** Mobile-only (under 768px) bottom tab bar. Upload is the filled amber center tab. */
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <Box
      asChild
      display={{ initial: "block", sm: "none" }}
      position="fixed"
      bottom="0"
      left="0"
      right="0"
      style={{
        zIndex: 20,
        backgroundColor: "var(--color-panel-solid)",
        borderTop: "1px solid var(--gray-a5)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <nav aria-label="Primary">
        <Flex align="stretch" px="1">
          {TABS.map((tab) => {
            const active = isActivePath(pathname, tab.href);
            return (
              <NextLink
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                style={{
                  flex: "1 1 0",
                  minWidth: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "flex-end",
                  gap: 2,
                  padding: "6px 2px 8px",
                  textDecoration: "none",
                  color: active ? "var(--gray-12)" : "var(--gray-11)",
                }}
              >
                {tab.primary ? (
                  <span
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 999,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: -18,
                      background: "var(--accent-9)",
                      color: "var(--accent-contrast)",
                      boxShadow: "0 4px 14px var(--accent-a6), 0 0 0 4px var(--color-panel-solid)",
                    }}
                  >
                    <NavIcon name={tab.icon} />
                  </span>
                ) : (
                  <NavIcon name={tab.icon} />
                )}
                <Text size="1" weight={active ? "medium" : "regular"} truncate>
                  {tab.label}
                </Text>
              </NextLink>
            );
          })}
        </Flex>
      </nav>
    </Box>
  );
}
