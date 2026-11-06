import { DocsSidebar } from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative z-[1] mx-auto flex max-w-6xl gap-12 px-5 py-12">
      <DocsSidebar />
      <main className="min-w-0 flex-1 pb-10">{children}</main>
    </div>
  );
}
