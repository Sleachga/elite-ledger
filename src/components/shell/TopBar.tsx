"use client";

import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { Box, Button, Container, Flex, Link } from "@radix-ui/themes";
import { isActivePath, TOP_NAV } from "./nav";
import { Wordmark } from "./Wordmark";

export function TopBar({ guildName }: { guildName: string }) {
  const pathname = usePathname();

  return (
    <Box
      asChild
      position="sticky"
      top="0"
      style={{
        zIndex: 20,
        backgroundColor: "var(--color-panel-translucent)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid var(--gray-a5)",
      }}
    >
      <header>
        <Container size="4" px={{ initial: "4", sm: "5" }}>
          <Flex align="center" justify="between" gap="4" height="56px">
            <Wordmark name={guildName} />

            <Flex asChild align="center" gap="5" display={{ initial: "none", sm: "flex" }}>
              <nav aria-label="Primary">
                {TOP_NAV.map((entry) => {
                  const active = isActivePath(pathname, entry.href);
                  return (
                    <Link
                      key={entry.href}
                      asChild
                      size="2"
                      color="gray"
                      highContrast={active}
                      weight={active ? "medium" : "regular"}
                      underline="none"
                    >
                      <NextLink href={entry.href} aria-current={active ? "page" : undefined}>
                        {entry.label}
                      </NextLink>
                    </Link>
                  );
                })}
              </nav>
            </Flex>

            <Box display={{ initial: "none", sm: "block" }}>
              <Button asChild size="2">
                <NextLink href="/upload">Upload</NextLink>
              </Button>
            </Box>
          </Flex>
        </Container>
      </header>
    </Box>
  );
}
