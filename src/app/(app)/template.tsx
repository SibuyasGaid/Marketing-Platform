"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Tab/page enter transition (docs/DESIGN.md §4): 150ms fade + 8px rise, and
 * nothing slower than 200ms. `template.tsx` re-mounts on navigation, so this
 * fires per tab change. Collapses to an instant state when the viewer prefers
 * reduced motion.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();

  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}
