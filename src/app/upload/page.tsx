import type { Metadata } from "next";
import { Flex, Heading, Link, Text } from "@radix-ui/themes";
import { TryPlayground } from "@/components/try/TryPlayground";

export const metadata: Metadata = {
  title: "Upload",
  description: "Read guild bank-log screenshots, check the rows, and copy them into the guild sheet.",
};

const sheetUrl = process.env.NEXT_PUBLIC_SHEET_URL?.trim();

export default function UploadPage() {
  return (
    <Flex direction="column" gap="5">
      <Flex direction="column" gap="2">
        <Heading as="h1" size="6">
          Upload
        </Heading>
        <Text as="p" color="gray" style={{ margin: 0 }}>
          Add guild bank-log screenshots, several at once. Let Claude read the deposit rows from each and
          check or correct them, or add the rows by hand.
        </Text>
        <Text as="p" size="2" weight="medium" style={{ margin: 0 }}>
          Rows are not saved on the site yet. Once every row is checked, press <strong>Confirm</strong>: the
          rows are copied for you to paste into the Ledger tab of{" "}
          {sheetUrl ? (
            <Link href={sheetUrl} target="_blank" rel="noreferrer">
              the guild sheet
            </Link>
          ) : (
            "the guild sheet"
          )}
          .
        </Text>
        <Text as="p" size="2" color="gray" style={{ margin: 0 }}>
          Avoid overlapping screenshots — every row is counted as its own deposit.
        </Text>
      </Flex>
      <TryPlayground sheetUrl={sheetUrl} />
    </Flex>
  );
}
