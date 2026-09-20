"use client";

import { motion, useReducedMotion } from "motion/react";

/** Pages fade/slide in (CLAUDE.md motion list). template.tsx remounts per navigation. */
export default function Template({ children }: { children: React.ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.25, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
