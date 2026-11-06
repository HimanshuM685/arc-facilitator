"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "motion/react";
import { Logo } from "./logo";
import { NetworkSwitch } from "./network-switch";

const LINKS = [
  { href: "/docs", label: "Docs", appear: "appear--scale", d: "0.16s" },
  { href: "/bazaar", label: "Bazaar", appear: "appear--soft", d: "0.24s" },
  { href: "/logs", label: "Transactions", appear: "appear--scale", d: "0.32s" },
  { href: "/test", label: "Test a payment", appear: "appear--soft", d: "0.40s" },
  { href: "/supported", label: "API", appear: "appear--scale", d: "0.52s" },
];

/**
 * Three-column header: logo · liquid-metal nav · network switch + CTA.
 * Under 901px the nav becomes a full-screen blurred menu behind a burger.
 */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // Close on navigation, Escape, and when the viewport grows back to desktop.
  useEffect(close, [pathname, close]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const desktop = window.matchMedia("(min-width: 901px)");
    const onResize = (e: MediaQueryListEvent) => e.matches && close();
    document.addEventListener("keydown", onKey);
    desktop.addEventListener("change", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      desktop.removeEventListener("change", onResize);
    };
  }, [close]);
  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
  }, [open]);

  const isActive = (href: string) =>
    href === "/docs" || href === "/bazaar" ? pathname.startsWith(href) : pathname === href;

  return (
    <>
      <div
        aria-hidden="true"
        onClick={close}
        className={[
          "fixed inset-0 z-40 bg-[rgba(8,8,8,0.42)] transition-[opacity,visibility,backdrop-filter] duration-300 min-[901px]:hidden",
          open ? "visible opacity-100 backdrop-blur-[24px]" : "invisible opacity-0",
        ].join(" ")}
      />

      <header
        className="relative z-50 grid grid-cols-[1fr_auto_auto] items-center gap-2 px-[var(--header-x)] pt-[max(var(--header-y),env(safe-area-inset-top))] pb-2.5 min-[901px]:grid-cols-[1fr_auto_1fr] min-[901px]:gap-4"
      >
        <Logo className="relative z-[80] justify-self-start appear appear--scale [--d:0.08s]" />

        <nav
          id="site-nav"
          aria-label="Primary"
          className={[
            // Desktop: centred row of pills.
            "min-[901px]:static min-[901px]:visible min-[901px]:flex min-[901px]:flex-row min-[901px]:items-center min-[901px]:gap-2 min-[901px]:p-0 min-[901px]:opacity-100",
            // Phone: full-viewport column over the blurred backdrop.
            "fixed inset-0 z-[45] flex flex-col items-stretch justify-center gap-3 px-[22px] pt-[max(96px,calc(env(safe-area-inset-top)+88px))] pb-8 transition-[opacity,visibility] duration-300",
            open ? "visible opacity-100" : "invisible opacity-0",
          ].join(" ")}
        >
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(link.href) ? "page" : undefined}
              onClick={close}
              style={{ ["--d" as string]: link.d }}
              className={`pill appear ${link.appear} max-[900px]:h-14 max-[900px]:w-full max-[900px]:justify-center max-[900px]:rounded-[10px] max-[900px]:text-[19px]`}
            >
              {link.label}
              {isActive(link.href) && (
                <motion.span
                  layoutId="nav-underline"
                  aria-hidden="true"
                  className="nav-underline"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
            </Link>
          ))}
          <div className="mt-4 flex justify-center min-[901px]:hidden">
            <NetworkSwitch />
          </div>
        </nav>

        <div className="relative z-[80] flex items-center justify-self-end gap-2 appear appear--scale [--d:0.34s]">
          <div className="hidden min-[1100px]:block">
            <NetworkSwitch />
          </div>
          <Link href="/docs/quickstart-merchant" className="btn-text btn-text--strong header-cta">
            Start building
            <svg className="btn-arrow" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h9.5M8.5 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Link>
        </div>

        <button
          type="button"
          aria-controls="site-nav"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
          className="relative z-[80] grid size-[42px] cursor-pointer place-content-center gap-[5px] rounded-md bg-transparent text-[var(--top-fg)] transition-colors hover:bg-white/5 min-[901px]:hidden appear appear--scale [--d:0.34s]"
        >
          <span className={`block h-[1.5px] w-4 rounded-[1px] bg-current transition-transform duration-250 ${open ? "translate-y-[6.5px] rotate-45" : ""}`} />
          <span className={`block h-[1.5px] w-4 rounded-[1px] bg-current transition-opacity duration-200 ${open ? "opacity-0" : ""}`} />
          <span className={`block h-[1.5px] w-4 rounded-[1px] bg-current transition-transform duration-250 ${open ? "-translate-y-[6.5px] -rotate-45" : ""}`} />
        </button>
      </header>
    </>
  );
}
