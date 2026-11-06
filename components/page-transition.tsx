"use client";

import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { EASE } from "./motion";

/**
 * Soft cross-route entrance for every inner page. app/template.tsx remounts on
 * each navigation, so this plays once per route. The landing page is skipped:
 * it has its own choreographed entrance.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/") return <>{children}</>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
