import { useState } from "react";
import { IconButton } from "../../components/IconButton";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/StatusBadge";
import { TagPill } from "../../components/ui/TagPill";
import { deriveCoverColor } from "../../lib/documentColor";
import { getSubjectTagTone, toneClassNames } from "../../styles/designTokens";
import type { LibraryDocument } from "../../types/library";

const MAX_VISIBLE_TAGS = 2;

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

// Anel de progresso circular exibido no canto inferior direito da thumbnail.
function CircularProgress({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle cx="9" cy="9" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <circle
        cx="9"
        cy="9"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 9 9)"
      />
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

export function DocumentCard(props: DocumentCardProps) {
  return props.viewMode === "grid" ? <DocumentGridCard {...props} /> : <DocumentListCard {...props} />;
}

// Card vertical (grid): thumbnail com cor derivada + area de texto abaixo.
function DocumentGridCard({ document, isSelected, mode = "library", onSelect, onToggleFavorite }: DocumentCardProps) {
  const isTrashMode = mode === "trash";
  const isReading = document.status === "in-progress";
  const coverColor = deriveCoverColor(document.id);
  const publisherLine = `${document.year} · ${document.source}`;
  const visibleTags = document.tags.slice(0, MAX_VISIBLE_TAGS);
  const extraTagCount = document.tags.length - visibleTags.length;
  const expirationDays = document.deletedAt ? getExpirationDays(document.deletedAt) : 0;

  return (
    <article
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-surface-card shadow-card transition hover:shadow-lg ${
        isSelected ? "border-primary ring-2 ring-primary-soft" : "border-border-subtle"
      }`}
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
      <div className="relative aspect-[3/4] w-full" style={{ backgroundColor: coverColor }}>
        {/* Linhas decorativas que imitam o topo de uma pagina. */}
        <div className="absolute inset-0 p-4" aria-hidden="true">
          <div className="h-1.5 w-2/5 rounded-full bg-black/10" />
          <div className="mt-3 space-y-1.5">
            <div className="h-1 w-3/4 rounded-full bg-black/[0.07]" />
            <div className="h-1 w-2/3 rounded-full bg-black/[0.07]" />
            <div className="h-1 w-1/2 rounded-full bg-black/[0.07]" />
          </div>
          <div className="mt-4 h-1 w-1/3 rounded-full bg-black/15" />
        </div>

        {/* Coracao de favorito: canto superior direito. */}
        {isTrashMode ? (
          document.favorite ? (
            <span
              className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm"
              style={{ color: "#EF4444" }}
              aria-label="Favorito"
            >
              <HeartIcon filled />
            </span>
          ) : null
        ) : (
          <button
            type="button"
            aria-label={document.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            title={document.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            className={`absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm transition ${
              document.favorite ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
            }`}
            style={{ color: "#EF4444" }}
            onClick={(event) => {
              event.stopPropagation();
              onToggleFavorite(document.id);
            }}
          >
            <HeartIcon filled={document.favorite} />
          </button>
        )}

        {/* Indicador de progresso circular: canto inferior direito. */}
        {isTrashMode ? null : (
          <span className="absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/80 text-text-primary shadow-sm">
            <CircularProgress value={document.progress} />
          </span>
        )}

        {/* Barra de progresso de leitura: linha fina na base da thumbnail. */}
        {!isTrashMode && isReading ? (
          <div
            className="absolute inset-x-0 bottom-0 h-[3px] bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, document.progress))}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
        <p className="truncate text-xs text-text-secondary">{publisherLine}</p>
        <h2 className="line-clamp-2 text-sm font-semibold text-text-primary">{document.title}</h2>
        <p className="truncate text-xs text-text-secondary">{formatAuthors(document.authors)}</p>

        {isTrashMode ? (
          <span
            className={`mt-2 inline-flex w-fit items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
              expirationDays <= 7 ? "bg-status-red text-status-red-text" : "bg-status-slate text-status-slate-text"
            }`}
          >
            Expira em {expirationDays} {expirationDays === 1 ? "dia" : "dias"}
          </span>
        ) : (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {visibleTags.map((tag) => (
              <TagPill key={tag} label={tag} />
            ))}
            {extraTagCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-secondary">
                +{extraTagCount}
              </span>
            ) : null}
          </div>
        )}
      </div>
    </article>
  );
}

// Card horizontal (lista): layout de linha existente, agora com TagPill.
function DocumentListCard({
  document,
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

  return (
    <article
      className={`flex min-h-28 cursor-pointer flex-row items-stretch gap-4 rounded-xl border bg-surface-card px-5 py-4 shadow-none transition hover:border-border-strong hover:shadow-card focus-within:border-primary ${
        isSelected ? "border-primary bg-primary-soft ring-2 ring-primary-soft" : "border-border-subtle"
      }`}
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
            <TagPill key={tag} label={tag} />
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
