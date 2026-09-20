import { Card, Flex, Text } from "@radix-ui/themes";

/** Empty state until the ledger exists (slice 2). */
export function RecentDeposits() {
  return (
    <Card size="2">
      <Flex direction="column" align="center" gap="1" py="4">
        <Text size="2" weight="medium">
          No deposits yet
        </Text>
        <Text size="2" color="gray" align="center">
          Once members upload bank-log screenshots, the latest confirmed deposits appear here.
        </Text>
      </Flex>
    </Card>
  );
}
