import { Flex, Heading, Text } from "@radix-ui/themes";

export function ComingSoon({ title }: { title: string }) {
  return (
    <Flex direction="column" gap="2">
      <Heading size="6">{title}</Heading>
      <Text color="gray">Coming in a later slice.</Text>
    </Flex>
  );
}
