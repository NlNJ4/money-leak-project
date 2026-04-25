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
    <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.05)] sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:mb-5">
        <h2 className="text-base font-semibold leading-6 text-zinc-950">
          {title}
        </h2>
        {subtitle ? (
          <p className="text-sm leading-6 text-zinc-500">{subtitle}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
