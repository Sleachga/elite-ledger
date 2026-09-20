"use client";

import { Card, Flex, Grid, Text } from "@radix-ui/themes";
import { CountUp } from "./CountUp";

export interface HeroStripProps {
  elitesCrafted: number;
  /** 0-100 */
  pctToNextElite: number;
  /** e.g. 2.35 */
  sharedElitesWorth: number;
  /** Pre-formatted; null renders as an em dash. */
  lastSynced: string | null;
}

function Stat({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <Card size="2">
      <Flex direction="column" gap="1" minWidth="0">
        <Text size="1" color="gray" weight="medium" style={{ textTransform: "uppercase", letterSpacing: "0.04em" }}>
          {label}
        </Text>
        <Text size="7" weight="bold" style={{ fontVariantNumeric: "tabular-nums", lineHeight: 1.1 }}>
          {children}
        </Text>
        {hint && (
          <Text size="1" color="gray">
            {hint}
          </Text>
        )}
      </Flex>
    </Card>
  );
}

/** Hero strip: 2x2 on phones, one row of four from 768px. */
export function HeroStrip({ elitesCrafted, pctToNextElite, sharedElitesWorth, lastSynced }: HeroStripProps) {
  return (
    <Grid columns={{ initial: "2", sm: "4" }} gap="3" aria-label="Summary">
      <Stat label="Elites crafted">
        <CountUp value={elitesCrafted} />
      </Stat>
      <Stat label="% to next Elite">
        <CountUp value={pctToNextElite} />%
      </Stat>
      <Stat label="Shared mats" hint="Elites' worth">
        <CountUp value={sharedElitesWorth} decimals={1} />
      </Stat>
      <Stat label="Last synced">{lastSynced ?? "—"}</Stat>
    </Grid>
  );
}
