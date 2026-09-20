import NextLink from "next/link";
import { Box, Flex, Text } from "@radix-ui/themes";

/** Small amber mark + guild name. "Elite Ledger" stays in the page title. */
export function Wordmark({ name }: { name: string }) {
  return (
    <Flex asChild align="center" gap="2">
      <NextLink href="/" style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}>
        <Box
          aria-hidden
          flexShrink="0"
          width="10px"
          height="10px"
          style={{
            background: "var(--accent-9)",
            borderRadius: "2px",
            transform: "rotate(45deg)",
            boxShadow: "0 0 0 2px var(--accent-a4)",
          }}
        />
        <Text size="3" weight="bold" truncate style={{ letterSpacing: "-0.01em" }}>
          {name}
        </Text>
      </NextLink>
    </Flex>
  );
}
