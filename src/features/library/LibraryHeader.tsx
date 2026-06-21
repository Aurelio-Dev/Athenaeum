import type { ReactNode } from "react";

type LibraryHeaderProps = {
  title: string;
  count: number;
  subtitle?: string;
  subtitleContent?: ReactNode;
};

export function LibraryHeader({ title, count, subtitle, subtitleContent }: LibraryHeaderProps) {
  return (
    <div className="min-w-64 flex-1">
      <h1 className="flex items-center gap-3 text-2xl font-bold tracking-normal text-text-primary">
        <span className="truncate">{title}</span>
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-sm font-semibold text-text-secondary">{count}</span>
      </h1>
      {subtitleContent ?? (subtitle ? <p className="mt-1 text-sm text-text-secondary">{subtitle}</p> : null)}
    </div>
  );
}
