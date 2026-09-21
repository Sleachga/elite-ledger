import type { Metadata } from "next";
import { Badge, Flex, Heading, Text } from "@radix-ui/themes";
import { TryPlayground } from "@/components/try/TryPlayground";

export const metadata: Metadata = {
  title: "Try the extractor",
  description: "Playground: see what the extractor reads from a guild bank-log screenshot. Nothing is saved.",
};

export default function TryPage() {
  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="2">
        <Flex align="center" gap="3" wrap="wrap">
          <Heading as="h1" size="6">
            Try the extractor
          </Heading>
          <Badge color="amber" variant="soft">
            Playground
          </Badge>
        </Flex>
        <Text as="p" color="gray" style={{ margin: 0 }}>
          Upload a guild bank-log screenshot and see the deposit rows Claude reads from it.
        </Text>
        <Text as="p" size="2" weight="medium" style={{ margin: 0 }}>
          Playground — nothing is saved to the ledger.
        </Text>
      </Flex>
      <TryPlayground />
    </Flex>
  );
}
