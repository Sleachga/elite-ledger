import type { Metadata } from "next";
import NextLink from "next/link";
import { Card, Flex, Heading, Text } from "@radix-ui/themes";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false },
};

const SECTIONS = [
  {
    href: "/admin/settings",
    title: "Settings",
    description: "Upload modes: switch AI reading of screenshots on or off, and pick the default mode.",
  },
] as const;

export default function AdminPage() {
  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="2">
        <Heading as="h1" size="6">
          Admin
        </Heading>
        <Text as="p" color="gray" style={{ margin: 0 }}>
          Passcode-gated until Discord login exists. Recipes, crafts and sync will join this list.
        </Text>
      </Flex>
      <Flex direction="column" gap="3" asChild>
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {SECTIONS.map((section) => (
            <li key={section.href}>
              <Card size="2" asChild>
                <NextLink href={section.href}>
                  <Flex direction="column" gap="1">
                    <Text size="3" weight="medium">
                      {section.title}
                    </Text>
                    <Text size="2" color="gray">
                      {section.description}
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
