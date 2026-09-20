"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import { formatDecimal } from "@/lib/format";

export interface CountUpProps {
  value: number;
  decimals?: number;
}

/**
 * Counts from 0 to `value` in 300ms ease-out on mount; jumps straight there
 * under reduced motion. Drives a MotionValue rather than React state so the
 * tween never re-renders the tree.
 */
export function CountUp({ value, decimals = 0 }: CountUpProps) {
  const reduceMotion = useReducedMotion();
  const raw = useMotionValue(0);
  const text = useTransform(raw, (latest) => formatDecimal(latest, decimals));

  useEffect(() => {
    if (reduceMotion) {
      raw.jump(value);
      return;
    }
    const controls = animate(raw, value, { duration: 0.3, ease: "easeOut" });
    return () => controls.stop();
  }, [raw, value, reduceMotion]);

  return <motion.span>{text}</motion.span>;
}
