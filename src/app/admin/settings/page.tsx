import type { Metadata } from "next";
import NextLink from "next/link";
import { Flex, Heading, Link, Text } from "@radix-ui/themes";
import { AdminSettings } from "@/components/admin/AdminSettings";

export const metadata: Metadata = {
  title: "Settings · Admin",
  robots: { index: false, follow: false },
};

export default function AdminSettingsPage() {
  return (
    <Flex direction="column" gap="5" maxWidth="640px">
      <Flex direction="column" gap="2">
        <Text size="2">
          <Link asChild color="gray" underline="hover">
            <NextLink href="/admin">← Admin</NextLink>
          </Link>
        </Text>
        <Heading as="h1" size="6">
          Settings
        </Heading>
        <Text as="p" color="gray" style={{ margin: 0 }}>
          How members get rows in on the upload screen. A change shows there within a few seconds, without a
          redeploy.
        </Text>
      </Flex>
      <AdminSettings />
    </Flex>
  );
}
