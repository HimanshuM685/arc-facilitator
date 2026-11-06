"use client";

/**
 * Motion building blocks for the inner pages (docs, transactions, test).
 * The landing page keeps its own CSS entrance choreography.
 *
 * One easing and one rhythm everywhere, so the site moves as one thing:
 * an expo-out curve, short distances, a touch of blur on the way in.
 */

import { MotionConfig, motion, type HTMLMotionProps, type Variants } from "motion/react";

export const EASE = [0.16, 1, 0.3, 1] as const;

/** Honour the OS "reduce motion" setting for every animation below. */
export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ ease: EASE }}>
      {children}
    </MotionConfig>
  );
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16, filter: "blur(6px)" },
  show: { opacity: 1, y: 0, filter: "blur(0px)", transition: { duration: 0.7, ease: EASE } },
};

/** Fades and lifts in on mount. */
export function FadeIn({ delay = 0, ...props }: HTMLMotionProps<"div"> & { delay?: number }) {
  return (
    <motion.div
      initial="hidden"
      animate="show"
      variants={fadeUp}
      transition={{ duration: 0.7, ease: EASE, delay }}
      {...props}
    />
  );
}

/** Fades and lifts in the first time it scrolls into view. */
export function Reveal({ delay = 0, ...props }: HTMLMotionProps<"div"> & { delay?: number }) {
  return (
    <motion.div
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "0px 0px -60px 0px" }}
      variants={fadeUp}
      transition={{ duration: 0.7, ease: EASE, delay }}
      {...props}
    />
  );
}

/** Children marked <StaggerItem> enter one after another. */
export function Stagger({
  gap = 0.08,
  delay = 0,
  inView = false,
  ...props
}: HTMLMotionProps<"div"> & { gap?: number; delay?: number; inView?: boolean }) {
  const variants: Variants = { hidden: {}, show: { transition: { staggerChildren: gap, delayChildren: delay } } };
  return (
    <motion.div
      initial="hidden"
      {...(inView ? { whileInView: "show", viewport: { once: true, margin: "0px 0px -40px 0px" } } : { animate: "show" })}
      variants={variants}
      {...props}
    />
  );
}

export function StaggerItem(props: HTMLMotionProps<"div">) {
  return <motion.div variants={fadeUp} {...props} />;
}

export { motion, AnimatePresence, LayoutGroup } from "motion/react";
