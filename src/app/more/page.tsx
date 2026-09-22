import type { Metadata } from "next";
import NextLink from "next/link";
import { Card, Flex, Heading, Text } from "@radix-ui/themes";
import { MORE_NAV } from "@/components/shell/nav";

export const metadata: Metadata = { title: "More" };

/** The mobile tab bar's fifth tab: the pages it has no room for. */
export default function MorePage() {
  return (
    <Flex direction="column" gap="4">
      <Heading as="h1" size="6">
        More
      </Heading>
      <Flex direction="column" gap="2" asChild>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {MORE_NAV.map((entry) => (
            <li key={entry.href}>
              <Card size="2" asChild>
                <NextLink href={entry.href}>
                  <Flex direction="column" gap="1">
                    <Text size="3" weight="medium">
                      {entry.label}
                    </Text>
                    <Text size="2" color="gray">
                      {entry.description}
                    </Text>
                  </Flex>
                </NextLink>
              </Card>
            </li>
          ))}
        </ul>
      </Flex>
    </Flex>
  );
}
