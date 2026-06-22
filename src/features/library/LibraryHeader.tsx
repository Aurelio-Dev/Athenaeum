type LibraryHeaderProps = {
  title: string;
  count: number;
};

export function LibraryHeader({ title, count }: LibraryHeaderProps) {
  return (
    <div className="min-w-64 flex-1">
      <h1 className="flex items-center gap-3 text-2xl font-bold tracking-normal text-text-primary">
        <span className="truncate">{title}</span>
        <span className="rounded-full bg-surface-muted px-2.5 py-1 text-sm font-semibold text-text-secondary">{count}</span>
      </h1>
    </div>
  );
}
