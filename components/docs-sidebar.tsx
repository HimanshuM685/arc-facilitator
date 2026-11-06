"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { DOCS, docHref } from "@/lib/docs-nav";
import { EASE } from "./motion";

/** Docs navigation. The highlight glides to the current page; sections stagger in once. */
export function DocsSidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-56 shrink-0 lg:block">
      <nav className="sticky top-8 space-y-6" aria-label="Documentation">
        {DOCS.map((section, sectionIndex) => (
          <motion.div
            key={section.heading}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: EASE, delay: 0.1 + sectionIndex * 0.08 }}
          >
            <p className="eyebrow mb-2">{section.heading}</p>
            <ul className="space-y-0.5">
              {section.entries.map((entry) => {
                const href = docHref(entry.slug);
                const active = pathname === href;
                return (
                  <li key={entry.slug} className="relative">
                    {active && (
                      <motion.span
                        layoutId="docs-active"
                        aria-hidden="true"
                        className="absolute inset-0 rounded-md border border-white/25 bg-white/[0.08]"
                        transition={{ type: "spring", stiffness: 380, damping: 34 }}
                      />
                    )}
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={[
                        "relative block rounded-md px-2.5 py-1.5 text-sm tracking-[-0.01em] transition-colors duration-300",
                        active ? "text-white" : "text-chalk-dim hover:bg-white/[0.04] hover:text-white",
                      ].join(" ")}
                    >
                      {entry.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        ))}
      </nav>
    </aside>
  );
}
