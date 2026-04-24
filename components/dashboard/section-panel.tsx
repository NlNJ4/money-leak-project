import type { ReactNode } from "react";

export function SectionPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-md border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-1">
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        {subtitle ? (
          <p className="text-sm leading-6 text-zinc-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
