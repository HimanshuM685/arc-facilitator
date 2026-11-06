"use client";

import { useEffect, useRef } from "react";

const HERO_VIDEO =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260818_072341_50851634-bbc3-4c33-9acc-7647d4db44aa.mp4";

/** Regions whose text colour follows the video behind them. */
const REGIONS = [
  { attr: "data-tone-top", selector: "header" },
  { attr: "data-tone-badge", selector: ".hero .badge" },
  { attr: "data-tone-hero", selector: ".hero h1" },
  { attr: "data-tone-bottom", selector: ".stats" },
] as const;

// Hysteresis, so a frame hovering around the threshold doesn't make text flicker.
const TO_LIGHT = 0.55;
const TO_DARK = 0.45;

/**
 * Full-bleed background video that also measures itself.
 *
 * A few times a second it samples the part of the current frame that sits
 * behind the header, the headline and the stats row, and tags <html> with
 * data-tone-*="light" | "dark". CSS swaps the text colours for that region and
 * transitions them slowly, so the type stays readable as the video changes.
 * The host serves the file with Access-Control-Allow-Origin: *, which is what
 * lets a crossOrigin video be read back from a canvas.
 */
export function HeroVideo() {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const root = document.documentElement;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    const tones: Record<string, "light" | "dark"> = {};

    const sample = () => {
      if (video.readyState < 2 || !video.videoWidth) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Undo object-fit: cover to map viewport pixels back onto the frame.
      const scale = Math.max(vw / video.videoWidth, vh / video.videoHeight);
      const offsetX = (video.videoWidth * scale - vw) / 2;
      const offsetY = (video.videoHeight * scale - vh) / 2;

      for (const region of REGIONS) {
        const el = document.querySelector(region.selector);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;

        const sx = (r.left + offsetX) / scale;
        const sy = (r.top + offsetY) / scale;
        const sw = r.width / scale;
        const sh = r.height / scale;
        canvas.width = 24;
        canvas.height = 12;
        try {
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, 24, 12);
          const { data } = ctx.getImageData(0, 0, 24, 12);
          const lums: number[] = [];
          for (let i = 0; i < data.length; i += 4) {
            // Relative luminance, sRGB weights.
            lums.push((0.2126 * data[i]! + 0.7152 * data[i + 1]! + 0.0722 * data[i + 2]!) / 255);
          }
          lums.sort((x, y) => x - y);
          // An average lies here: a bright band across a black frame averages
          // "dark" while the type sits right on the band. So:
          //  - bright = 80th percentile → how strong the halo behind light type is;
          //  - floor  = 20th percentile → flip to dark type only when even the
          //    darkest part of the region is bright (else dark type vanishes there).
          const bright = lums[Math.floor(lums.length * 0.8)]!;
          const floor = lums[Math.floor(lums.length * 0.2)]!;
          const name = region.attr.replace("data-tone-", "");
          root.style.setProperty(`--lum-${name}`, bright.toFixed(2));
          const lum = floor;
          const prev = tones[region.attr] ?? "dark";
          const next = prev === "dark" ? (lum > TO_LIGHT ? "light" : "dark") : lum < TO_DARK ? "dark" : "light";
          if (next !== prev || !(region.attr in tones)) {
            tones[region.attr] = next;
            root.setAttribute(region.attr, next);
          }
        } catch {
          // Canvas tainted (CORS changed upstream): keep the default dark-tone styling.
          return;
        }
      }
    };

    const timer = window.setInterval(sample, 250);
    return () => {
      window.clearInterval(timer);
      for (const region of REGIONS) {
        root.removeAttribute(region.attr);
        root.style.removeProperty(`--lum-${region.attr.replace("data-tone-", "")}`);
      }
    };
  }, []);

  return (
    <div className="hero-photo" aria-hidden="true">
      <video ref={ref} autoPlay muted loop playsInline preload="auto" crossOrigin="anonymous" src={HERO_VIDEO} />
    </div>
  );
}
