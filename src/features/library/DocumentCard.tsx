import type { CSSProperties } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { IconContextAbrir, IconContextMoverColecao, IconContextVerDetalhes } from "../../components/ui/ContextMenuIcons";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { ContextMenuSubmenu } from "../../components/ui/ContextMenuSubmenu";
import { HeartIcon, TrashIcon } from "../../components/ui/SharedIcons";
import { TagPill } from "../../components/ui/TagPill";
import { deriveCoverHue } from "../../lib/documentColor";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { LibraryCollection, LibraryDocument, ViewMode } from "../../types/library";

const MAX_VISIBLE_TAGS = 2;

type DocumentCoverStyle = CSSProperties & {
  "--document-cover-hue": string;
};

type DocumentCardProps = {
  document: LibraryDocument;
  isSelected: boolean;
  mode?: "library" | "trash";
  viewMode?: ViewMode;
  collections: LibraryCollection[];
  onSelect: (document: LibraryDocument) => void;
  onOpenReader: (document: LibraryDocument) => void;
  onOpenDetails: (document: LibraryDocument) => void;
  onToggleFavorite: (documentId: string) => void;
  onMoveToCollection: (documentId: string, collectionId: string) => void;
  onDelete: (documentId: string) => void;
};

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

function getCoverStyle(documentId: string): DocumentCoverStyle {
  return { "--document-cover-hue": String(deriveCoverHue(documentId)) };
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

type DocumentCardContextMenuProps = Pick<
  DocumentCardProps,
  "collections" | "document" | "onDelete" | "onMoveToCollection" | "onOpenDetails" | "onOpenReader" | "onToggleFavorite"
> & {
  contextMenu: ReturnType<typeof useContextMenu>;
};

function DocumentCardContextMenu({
  collections,
  contextMenu,
  document,
  onDelete,
  onMoveToCollection,
  onOpenDetails,
  onOpenReader,
  onToggleFavorite,
}: DocumentCardContextMenuProps) {
  return (
    <ContextMenu isOpen={contextMenu.isOpen} x={contextMenu.x} y={contextMenu.y} onClose={contextMenu.close}>
      <ContextMenuItem
        icon={<IconContextAbrir />}
        label="Abrir"
        onSelect={() => {
          onOpenReader(document);
          contextMenu.close();
        }}
      />
      <ContextMenuItem
        icon={<IconContextVerDetalhes />}
        label="Ver detalhes"
        onSelect={() => {
          onOpenDetails(document);
          contextMenu.close();
        }}
      />

      <ContextMenuDivider />

      <ContextMenuItem
        icon={<HeartIcon filled={document.favorite} size={16} />}
        label={document.favorite ? "Desfavoritar" : "Favoritar"}
        onSelect={() => {
          onToggleFavorite(document.id);
          contextMenu.close();
        }}
      />

      <ContextMenuDivider />

      <ContextMenuSubmenu
        icon={<IconContextMoverColecao />}
        label="Mover para coleção"
        collections={collections}
        onSelect={(collectionId) => onMoveToCollection(document.id, collectionId)}
        onClose={contextMenu.close}
      />

      <ContextMenuDivider />

      <ContextMenuItem
        icon={<TrashIcon size={16} />}
        label="Mover para lixeira"
        variant="danger"
        onSelect={() => {
          onDelete(document.id);
          contextMenu.close();
        }}
      />
    </ContextMenu>
  );
}

// Linha horizontal (lista): thumb pequena + metadados + tags + favorito.
function DocumentListRow({ collections, document, isSelected, mode = "library", onDelete, onMoveToCollection, onOpenDetails, onOpenReader, onSelect, onToggleFavorite }: DocumentCardProps) {
  const contextMenu = useContextMenu();
  const isTrashMode = mode === "trash";
  const coverStyle = getCoverStyle(document.id);
  const publisherLine = `${document.year} · ${document.source}`;
  const visibleTags = document.tags.slice(0, MAX_VISIBLE_TAGS);
  const extraTagCount = document.tags.length - visibleTags.length;
  const expirationDays = document.deletedAt ? getExpirationDays(document.deletedAt) : 0;

  return (
    <>
      <article
        className={`group flex cursor-pointer items-center gap-4 rounded-xl border bg-surface-card p-3 shadow-card transition hover:-translate-y-1 ${
          isSelected ? "border-primary ring-2 ring-primary-soft" : "border-border-subtle"
        }`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelect(document)}
        onContextMenu={contextMenu.open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(document);
          }
        }}
      >
        <div className="document-cover-swatch relative h-16 w-12 shrink-0 overflow-hidden rounded-md" style={coverStyle} />

        <div className="min-w-0 flex-1">
          <h2 className="truncate font-sans text-[15px] font-semibold leading-[21px] text-[#2C1810] dark:text-text-primary">{document.title}</h2>
          <p className="truncate font-sans text-[11px] font-normal leading-[16.5px] text-text-secondary">{formatAuthors(document.authors)}</p>
          <p className="truncate font-sans text-[11px] font-normal leading-[16.5px] text-text-secondary">{publisherLine}</p>
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

            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-text-primary dark:text-primary">
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
      <DocumentCardContextMenu
        collections={collections}
        contextMenu={contextMenu}
        document={document}
        onDelete={onDelete}
        onMoveToCollection={onMoveToCollection}
        onOpenDetails={onOpenDetails}
        onOpenReader={onOpenReader}
        onToggleFavorite={onToggleFavorite}
      />
    </>
  );
}

// Card vertical (grid): thumbnail com cor derivada + area de texto abaixo.
function DocumentGridCard({ collections, document, isSelected, mode = "library", onDelete, onMoveToCollection, onOpenDetails, onOpenReader, onSelect, onToggleFavorite }: DocumentCardProps) {
  const contextMenu = useContextMenu();
  const isTrashMode = mode === "trash";
  const coverStyle = getCoverStyle(document.id);
  const publisherLine = `${document.year} · ${document.source}`;
  const visibleTags = document.tags.slice(0, MAX_VISIBLE_TAGS);
  const extraTagCount = document.tags.length - visibleTags.length;
  const expirationDays = document.deletedAt ? getExpirationDays(document.deletedAt) : 0;

  return (
    <>
      <article
        className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-surface-card shadow-card transition hover:-translate-y-1 ${
          isSelected ? "border-primary ring-2 ring-primary-soft" : "border-border-subtle"
        }`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        onClick={() => onSelect(document)}
        onContextMenu={contextMenu.open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect(document);
          }
        }}
      >
      {/* Faixa superior SEMPRE no accent fixo (token primary) — mesma marca
          visual dos cards de Cadernos/Quadros. A cor da capa (deriveCoverHue)
          continua variando por documento; so a faixa e fixa. O overflow-hidden
          + rounded-xl do card clipa a faixa nos cantos arredondados. */}
      <div className="h-[3px] w-full shrink-0 bg-primary" aria-hidden="true" />
      <div className="document-cover-swatch relative aspect-[3/4] w-full" style={coverStyle}>
        {/* Linhas decorativas que imitam o topo de uma pagina. */}
        <div className="absolute inset-0 p-4" aria-hidden="true">
          <div className="document-cover-line document-cover-line-strong h-1.5 w-2/5 rounded-full" />
          <div className="mt-3 space-y-1.5">
            <div className="document-cover-line h-1 w-3/4 rounded-full" />
            <div className="document-cover-line h-1 w-2/3 rounded-full" />
            <div className="document-cover-line h-1 w-1/2 rounded-full" />
          </div>
          <div className="document-cover-line document-cover-line-strong mt-4 h-1 w-1/3 rounded-full" />
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
          <span className="absolute bottom-2 right-2 inline-flex h-6 w-6 items-center justify-center text-text-primary dark:text-primary">
            <CircularProgress value={document.progress} />
          </span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1 p-4">
        <p className="truncate font-sans text-[11px] font-normal leading-[16.5px] text-text-secondary">{publisherLine}</p>
        <h2 className="line-clamp-2 font-sans text-[15px] font-semibold leading-[21px] text-[#2C1810] dark:text-text-primary">{document.title}</h2>
        <p className="truncate font-sans text-[11px] font-normal leading-[16.5px] text-text-secondary">{formatAuthors(document.authors)}</p>

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
      <DocumentCardContextMenu
        collections={collections}
        contextMenu={contextMenu}
        document={document}
        onDelete={onDelete}
        onMoveToCollection={onMoveToCollection}
        onOpenDetails={onOpenDetails}
        onOpenReader={onOpenReader}
        onToggleFavorite={onToggleFavorite}
      />
    </>
  );
}
