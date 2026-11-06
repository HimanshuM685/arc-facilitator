import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { FadeIn, Reveal, Stagger, StaggerItem } from "@/components/motion";
import { DOC_ENTRIES, docHref, docNeighbours, findDoc } from "@/lib/docs-nav";

type Params = { slug?: string[] };

/**
 * The doc list is closed, so anything outside generateStaticParams is a real 404
 * rather than a page to render on demand. Without this, Next serves the
 * not-found shell with a 200 for any unknown slug.
 */
export const dynamicParams = false;

/** Only the pages listed in DOCS exist; a stray .mdx file is not routable. */
export function generateStaticParams(): Params[] {
  return DOC_ENTRIES.map((entry) => (entry.slug === "index" ? { slug: [] } : { slug: [entry.slug] }));
}

const slugFrom = (params: Params) => params.slug?.join("/") ?? "index";

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const entry = findDoc(slugFrom(await params));
  if (!entry) return {};
  return { title: entry.title, description: entry.summary };
}

export default async function DocPage({ params }: { params: Promise<Params> }) {
  const slug = slugFrom(await params);
  const entry = findDoc(slug);
  if (!entry) notFound();

  // Dynamic import over a fixed directory: webpack bundles every .mdx under
  // content/docs and resolves this at request time, which keeps the page list in
  // lib/docs-nav.ts rather than duplicated as one route file per page.
  const { default: Body } = await import(`@/content/docs/${slug}.mdx`);
  const { prev, next } = docNeighbours(slug);

  return (
    <article>
      <Stagger gap={0.08} className="mb-10 border-b border-ink-line pb-8">
        <StaggerItem>
          <p className="eyebrow">Documentation</p>
        </StaggerItem>
        <StaggerItem>
          <h1 className="page-title mt-3">{entry.title}</h1>
        </StaggerItem>
        <StaggerItem>
          <p className="page-lede">{entry.summary}</p>
        </StaggerItem>
      </Stagger>

      <FadeIn delay={0.25} className="prose-docs max-w-none">
        <Body />
      </FadeIn>

      {(prev || next) && (
        <Reveal role="navigation" aria-label="Previous and next page" className="mt-16 flex gap-3 border-t border-ink-line pt-6 text-sm">
          {prev && (
            <Link
              href={docHref(prev.slug)}
              className="btn btn-ghost h-auto py-3"
            >
              ← {prev.title}
            </Link>
          )}
          {next && (
            <Link
              href={docHref(next.slug)}
              className="btn btn-ghost ml-auto h-auto py-3"
            >
              {next.title} →
            </Link>
          )}
        </Reveal>
      )}
    </article>
  );
}
