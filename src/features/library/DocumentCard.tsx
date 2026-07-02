import { TagPill } from "../../components/ui/TagPill";
import { deriveCoverColor } from "../../lib/documentColor";
import type { LibraryDocument, ViewMode } from "../../types/library";

const MAX_VISIBLE_TAGS = 2;

type DocumentCardProps = {
  document: LibraryDocument;
  isSelected: boolean;
  mode?: "library" | "trash";
  viewMode?: ViewMode;
  onSelect: (document: LibraryDocument) => void;
  onToggleFavorite: (documentId: string) => void;
  onDelete: (documentId: string) => void;
};

function HeartIcon({ filled }: { filled: boolean }) {
  // Coracao de favorito (favorites-icon.svg). fill controla o estado ativo:
  // preenchido quando favoritado, so contorno caso contrario.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 14 14"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="1.16667"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.0833 8.16667C11.9525 7.315 12.8333 6.29417 12.8333 4.95833C12.8333 4.10743 12.4953 3.29138 11.8936 2.6897C11.292 2.08802 10.4759 1.75 9.625 1.75C8.59833 1.75 7.875 2.04167 7 2.91667C6.125 2.04167 5.40167 1.75 4.375 1.75C3.5241 1.75 2.70804 2.08802 2.10637 2.6897C1.50469 3.29138 1.16667 4.10743 1.16667 4.95833C1.16667 6.3 2.04167 7.32083 2.91667 8.16667L7 12.25L11.0833 8.16667Z" />
    </svg>
  );
}

// Anel de progresso circular exibido no canto inferior direito da thumbnail.
function CircularProgress({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, value));
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  // O SVG preenche o container (h-full w-full) e o anel e desenhado no centro
  // exato do viewBox (cx/cy = 12), ficando sempre concentrico com o circulo
  // branco — sem depender de centralizacao via flex (que deixava o anel
  // levemente deslocado dentro do circulo).
  return (
    <svg className="block h-full w-full" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r={radius} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3" />
      <circle
        cx="12"
        cy="12"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        transform="rotate(-90 12 12)"
      />
    </svg>
  );
}

function formatAuthors(authors: string[]) {
  return authors.length > 4 ? `${authors.slice(0, 4).join(", ")} et al.` : authors.join(", ");
}

function getExpirationDays(deletedAt: string) {
  const deletedTime = new Date(deletedAt).getTime();
  const expiresAt = deletedTime + 30 * 24 * 60 * 60 * 1000;
  const dayInMilliseconds = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / dayInMilliseconds));
}

export function DocumentCard(props: DocumentCardProps) {
  if (props.viewMode === "list") {
    return <DocumentListRow {...props} />;
  }

  return <DocumentGridCard {...props} />;
}

// Linha horizontal (lista): thumb pequena + metadados + tags + favorito.
function DocumentListRow({ document, isSelected, mode = "library", onSelect, onToggleFavorite }: DocumentCardProps) {
  const isTrashMode = mode === "trash";
  const coverColor = deriveCoverColor(document.id);
  const publisherLine = `${document.year} · ${document.source}`;
  const visibleTags = document.tags.slice(0, MAX_VISIBLE_TAGS);
  const extraTagCount = document.tags.length - visibleTags.length;
  const expirationDays = document.deletedAt ? getExpirationDays(document.deletedAt) : 0;

  return (
    <article
      className={`group flex cursor-pointer items-center gap-4 rounded-xl border bg-surface-card p-3 shadow-card transition hover:-translate-y-1 ${
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
      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md" style={{ backgroundColor: coverColor }}>
        {!isTrashMode && document.status === "in-progress" ? (
          <div
            className="absolute inset-x-0 bottom-0 h-[3px] bg-primary"
            style={{ width: `${Math.min(100, Math.max(0, document.progress))}%` }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[13px] font-semibold leading-[17.5px] text-[#2C1810] dark:text-text-primary">{document.title}</h2>
        <p className="truncate text-xs text-text-secondary">{formatAuthors(document.authors)}</p>
        <p className="truncate text-xs text-text-secondary">{publisherLine}</p>
      </div>

      {isTrashMode ? (
        <span
          className={`inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
            expirationDays <= 7 ? "bg-status-red text-status-red-text" : "bg-status-slate text-status-slate-text"
          }`}
        >
          Expira em {expirationDays} {expirationDays === 1 ? "dia" : "dias"}
        </span>
      ) : (
        <>
          <div className="hidden shrink-0 items-center gap-1.5 md:flex">
            {visibleTags.map((tag) => (
              <TagPill key={tag} label={tag} />
            ))}
            {extraTagCount > 0 ? (
              <span className="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-text-secondary">
                +{extraTagCount}
              </span>
            ) : null}
          </div>

          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-text-primary">
            <CircularProgress value={document.progress} />
          </span>

          <button
            type="button"
            aria-label={document.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            title={document.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition ${
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
        </>
      )}
    </article>
  );
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
      className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-surface-card shadow-card transition hover:-translate-y-1 ${
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
        <h2 className="line-clamp-2 text-[13px] font-semibold leading-[17.5px] text-[#2C1810] dark:text-text-primary">{document.title}</h2>
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
