"use client";

import { useState } from "react";

/**
 * A merchant's icon, fetched from their own site by the visitor's browser:
 * the `iconUrl` they declared, else `<origin>/favicon.ico`, else their initial.
 * Our server never fetches it.
 */
export function MerchantIcon({
  iconUrl,
  website,
  name,
  size = 40,
}: {
  iconUrl: string | null;
  website: string | null;
  name: string;
  size?: number;
}) {
  const candidates = [iconUrl, website ? `${new URL(website).origin}/favicon.ico` : null].filter(
    (c): c is string => !!c,
  );
  const [index, setIndex] = useState(0);
  const src = candidates[index];

  return (
    <span
      className="grid shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- third-party favicon, no optimisation wanted
        <img
          src={src}
          alt=""
          width={size * 0.6}
          height={size * 0.6}
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
          className="object-contain"
          style={{ width: size * 0.6, height: size * 0.6 }}
        />
      ) : (
        <span className="font-medium text-white/80" style={{ fontSize: size * 0.42 }}>
          {(name.trim()[0] ?? "?").toUpperCase()}
        </span>
      )}
    </span>
  );
}
