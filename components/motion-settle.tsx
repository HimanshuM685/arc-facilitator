"use client";

import { useEffect } from "react";

/**
 * Entrance-motion bookkeeping for `.appear` elements anywhere on the site:
 *  - when an element's own entrance animation ends, mark it `.is-in` (rest state);
 *  - if animations are not running at all, show everything at rest immediately,
 *    so a browser that skips CSS animation never leaves the page blank.
 */
export function MotionSettle() {
  useEffect(() => {
    const onEnd = (e: AnimationEvent) => {
      const el = e.target as HTMLElement;
      if (el.classList.contains("appear") || el.classList.contains("hero-photo")) el.classList.add("is-in");
    };
    document.addEventListener("animationend", onEnd);

    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => {
        const probe = document.querySelector<HTMLElement>(".appear:not(.is-in)");
        const running = probe?.getAnimations?.().some((a) => a.playState === "running" || a.playState === "finished");
        if (probe && !running) {
          document.querySelectorAll(".appear, .hero-photo").forEach((el) => el.classList.add("is-in"));
        }
      });
    });

    return () => {
      document.removeEventListener("animationend", onEnd);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
