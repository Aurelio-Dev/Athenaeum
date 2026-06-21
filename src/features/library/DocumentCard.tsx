import { useState } from "react";
import { IconButton } from "../../components/IconButton";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/StatusBadge";
import { TagBadge } from "../../components/TagBadge";
import { getSubjectTagTone, toneClassNames } from "../../styles/designTokens";
import type { LibraryDocument } from "../../types/library";

type DocumentCardProps = {
  document: LibraryDocument;
  viewMode: "list" | "grid";
  isSelected: boolean;
  mode?: "library" | "trash";
  onSelect: (document: LibraryDocument) => void;
  onToggleFavorite: (documentId: string) => void;
  onDelete: (documentId: string) => void;
};

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.4 12 20 12 20z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function formatAuthors(authors: string[]) {
  return authors.length > 4 ? `${authors.slice(0, 4).join(", ")} et al.` : authors.join(", ");
}

function formatRelativePast(value: string) {
  const dateTime = new Date(value).getTime();
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  const diffInDays = Math.max(1, Math.round((Date.now() - dateTime) / dayInMilliseconds));

  if (diffInDays < 7) {
    return diffInDays === 1 ? "1 dia atras" : `${diffInDays} dias atras`;
  }

  const diffInWeeks = Math.round(diffInDays / 7);
  return diffInWeeks === 1 ? "1 semana atras" : `${diffInWeeks} semanas atras`;
}

function formatDeletedAt(deletedAt: string) {
  const dateTime = new Date(deletedAt).getTime();
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  const diffInDays = Math.max(1, Math.round((Date.now() - dateTime) / dayInMilliseconds));
  return diffInDays === 1 ? "Excluido ha 1 dia" : `Excluido ha ${diffInDays} dias`;
}

function getExpirationDays(deletedAt: string) {
  const deletedTime = new Date(deletedAt).getTime();
  const expiresAt = deletedTime + 30 * 24 * 60 * 60 * 1000;
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / dayInMilliseconds));
}

export function DocumentCard({
  document,
  viewMode,
  isSelected,
  mode = "library",
  onSelect,
  onToggleFavorite,
  onDelete,
}: DocumentCardProps) {
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const spineTone = getSubjectTagTone(document.tags[0]);
  const metadata = `${formatAuthors(document.authors)} - ${document.source}, ${document.year}`;
  const isReading = document.status === "in-progress";
  const isTrashMode = mode === "trash";
  const expirationDays = document.deletedAt ? getExpirationDays(document.deletedAt) : 0;
  const wrapperClassName = viewMode === "grid" ? "min-h-44 flex-col gap-4 p-5" : "min-h-28 flex-row items-stretch gap-4 px-5 py-4";

  return (
    <article
      className={`flex cursor-pointer rounded-xl border bg-surface-card shadow-none transition hover:border-border-strong hover:shadow-card focus-within:border-primary ${
        isSelected ? "border-primary bg-primary-soft ring-2 ring-primary-soft" : "border-border-subtle"
      } ${wrapperClassName}`}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onSelect(document)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(document);
        }
      }}
    >
      <div className={`w-1 shrink-0 rounded-full ${toneClassNames[spineTone].spine}`} aria-hidden="true" />

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold tracking-normal text-text-primary">{document.title}</h2>
          <p className="mt-1 truncate text-sm text-text-secondary">{metadata}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {document.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      </div>

      <div className="flex w-56 shrink-0 flex-col items-end justify-between gap-3">
        <div className="flex items-center gap-3">
          {isTrashMode && document.favorite ? (
            <span className="text-status-red-text" aria-label="Favorito">
              <HeartIcon filled />
            </span>
          ) : null}
          <span className="whitespace-nowrap text-sm text-text-secondary">
            {isTrashMode && document.deletedAt ? formatDeletedAt(document.deletedAt) : formatRelativePast(document.updatedAt)}
          </span>
          {isTrashMode ? null : (
            <IconButton
              label={document.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              variant={document.favorite ? "accent" : "ghost"}
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite(document.id);
              }}
            >
              <HeartIcon filled={document.favorite} />
            </IconButton>
          )}
        </div>

        {isTrashMode ? (
          <span
            className={`rounded-md px-2.5 py-1 text-xs font-semibold ${
              expirationDays <= 7 ? "bg-status-red text-status-red-text" : "bg-status-slate text-status-slate-text"
            }`}
          >
            Expira em {expirationDays} {expirationDays === 1 ? "dia" : "dias"}
          </span>
        ) : isReading ? (
          <ProgressBar value={document.progress} />
        ) : (
          <StatusBadge status={document.status} />
        )}

        {isTrashMode ? null : isConfirmingDelete ? (
          <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              aria-label="Confirmar mover para lixeira"
              title="Confirmar mover para lixeira"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-status-green text-status-green-text transition hover:brightness-95"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(document.id);
              }}
            >
              <CheckIcon />
            </button>
            <button
              type="button"
              aria-label="Cancelar"
              title="Cancelar"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-status-red text-status-red-text transition hover:brightness-95"
              onClick={(event) => {
                event.stopPropagation();
                setIsConfirmingDelete(false);
              }}
            >
              <CloseIcon />
            </button>
          </div>
        ) : (
          <IconButton
            label="Mover para lixeira"
            variant="danger"
            onClick={(event) => {
              event.stopPropagation();
              setIsConfirmingDelete(true);
            }}
          >
            <TrashIcon />
          </IconButton>
        )}
      </div>
    </article>
  );
}
