import type { Metadata, Viewport } from "next";
import "@radix-ui/themes/styles.css";
import "./globals.css";
import { Box, Container, Theme } from "@radix-ui/themes";
import { BottomTabs } from "@/components/shell/BottomTabs";
import { TopBar } from "@/components/shell/TopBar";

const guildName = process.env.NEXT_PUBLIC_GUILD_NAME?.trim() || "Elite Ledger";

export const metadata: Metadata = {
  title: { default: `${guildName} · Elite Ledger`, template: `%s · ${guildName}` },
  description: `Public, verifiable ledger of Elite-craft materials deposited into the ${guildName} guild bank.`,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#111113",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body>
        <Theme appearance="dark" grayColor="slate" accentColor="amber" radius="medium">
          <TopBar guildName={guildName} />
          <Box asChild pb={{ initial: "9", sm: "6" }}>
            <main>
              <Container size="4" px={{ initial: "4", sm: "5" }} py={{ initial: "4", sm: "6" }}>
                {children}
              </Container>
            </main>
          </Box>
          <BottomTabs />
        </Theme>
      </body>
    </html>
  );
}
