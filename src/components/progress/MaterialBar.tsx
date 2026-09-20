"use client";

import { motion, useReducedMotion } from "motion/react";
import { Badge, Box, Flex, Text } from "@radix-ui/themes";
import { ItemChip, type ItemChipItem } from "@/components/ItemChip";

export interface MaterialBarProps {
  item: ItemChipItem;
  /** Visible name; defaults to the item name. */
  label?: string;
  /** Pre-formatted quantities. */
  have: string;
  need: string;
  /** 0-100 */
  pct: number;
  /** For fragment bars: renders "→ N craftable". */
  craftable?: number;
}

/** One have/need bar. Fills from 0 on mount (300ms ease-out); instant under reduced motion. */
export function MaterialBar({ item, label, have, need, pct, craftable }: MaterialBarProps) {
  const reduceMotion = useReducedMotion();
  const complete = pct >= 100;

  return (
    <Box>
      <Flex align="center" justify="between" gap="3">
        <ItemChip item={item} size="lg" label={label} />
        <Flex align="center" gap="2" flexShrink="0">
          {craftable !== undefined && (
            <Badge color={craftable > 0 ? "green" : "gray"} variant="soft" size="1">
              → {craftable} craftable
            </Badge>
          )}
          <Text size="2" color="gray" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {have} / {need}
          </Text>
        </Flex>
      </Flex>
      <Box
        mt="2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={`${label ?? item.name}: ${have} of ${need}`}
        style={{ height: 8, borderRadius: 999, background: "var(--gray-a4)", overflow: "hidden" }}
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
          style={{
            height: "100%",
            borderRadius: 999,
            background: complete ? "var(--green-9)" : "var(--accent-9)",
          }}
        />
      </Box>
    </Box>
  );
}
