import type { MDXComponents } from "mdx/types";
import { Children, isValidElement, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";
import { NetCode, NetField, NetVal, OnlyOn } from "@/components/net";

/** Plain text of a heading's children, for its anchor id. */
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return Children.toArray(node).map(textOf).join("");
}

/** "3. Discover a merchant's endpoints" → "3-discover-a-merchants-endpoints". */
const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/**
 * Components available to every MDX file without an import.
 *
 * The network-aware ones are what let the docs stay a single tree: prose is
 * written once and `{{token}}` placeholders in NetCode, plus NetVal/NetField,
 * resolve against whichever network the header toggle has selected.
 */
export function useMDXComponents(components: MDXComponents): MDXComponents {
  // Heading ids are unique per page: a repeated heading gets "-2", "-3"…, and one
  // with no slug-able text (symbols only, non-Latin) falls back to "section".
  const seen = new Map<string, number>();
  const idFor = (children: ReactNode) => {
    const base = slugify(textOf(children)) || "section";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}-${n}`;
  };

  // Linkable headings, so docs can point at a section (/docs/bazaar#3-discover-…).
  const heading =
    (Tag: "h2" | "h3") =>
    function Heading({ children, ...rest }: ComponentProps<"h2">) {
      return (
        <Tag id={idFor(children)} {...rest}>
          {children}
        </Tag>
      );
    };

  return {
    h2: heading("h2"),
    h3: heading("h3"),
    NetCode,
    NetField,
    NetVal,
    OnlyOn,
    a: ({ href, children, ...rest }) => {
      const target = String(href ?? "");
      // Same-page section links scroll in place.
      if (target.startsWith("#")) {
        return (
          <a href={target} {...rest}>
            {children}
          </a>
        );
      }
      // Internal links go through next/link so docs navigation stays client-side
      // and the ?network= selection survives the hop.
      return target.startsWith("/") ? (
        <Link href={target} {...rest}>
          {children}
        </Link>
      ) : (
        <a href={target} target="_blank" rel="noreferrer" {...rest}>
          {children}
        </a>
      );
    },
    ...components,
  };
}
