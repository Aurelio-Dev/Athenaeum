import type { ReactNode } from "react";

type CompactDocumentCardProps = {
  title: string;
  authors: string[];
  year: number;
  trailingAction?: ReactNode;
};

function PdfIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

export function CompactDocumentCard({ title, authors, year, trailingAction }: CompactDocumentCardProps) {
  return (
    <div className="group flex items-start gap-2 rounded-md border border-border-subtle bg-surface-card px-3 py-2">
      <span className="mt-0.5 shrink-0 rounded-md bg-status-red px-1.5 py-1 text-text-inverse">
        <PdfIcon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary" title={title}>
          {title}
        </p>
        <p className="truncate text-xs text-text-secondary">
          {authors.length > 0 ? authors.join(", ") : "Sem autor"} - {year}
        </p>
      </div>
      {trailingAction ? <div className="shrink-0">{trailingAction}</div> : null}
    </div>
  );
}
