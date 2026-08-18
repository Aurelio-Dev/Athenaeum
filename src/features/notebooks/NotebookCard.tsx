import { HeartIcon } from "../../components/ui/SharedIcons";
import { useContextMenu } from "../../hooks/useContextMenu";
import { formatEditedAgo } from "../../lib/relativeTime";
import type { LibraryCollection, Notebook } from "../../types/library";
import { LibraryItemContextMenu } from "../library/LibraryItemContextMenu";

// Ilustracao do caderno espiral (NotebookIcon.svg da pasta de referencia).
// E uma ilustracao com paleta propria (dois tons de terracota), nao um glifo
// de UI; por isso as cores ficam fixas em vez de currentColor.
export function NotebookIllustration({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 56 56" fill="none" aria-hidden="true">
      <path
        d="M41.125 6.125H14.875C13.4253 6.125 12.25 7.30025 12.25 8.75V47.25C12.25 48.6997 13.4253 49.875 14.875 49.875H41.125C42.5747 49.875 43.75 48.6997 43.75 47.25V8.75C43.75 7.30025 42.5747 6.125 41.125 6.125Z"
        stroke="#C4956A"
        strokeWidth="1.3125"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19.25 6.125V49.875" stroke="#C4956A" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.25 12.25C16.625 12.25 14.875 14 14.875 14.875C14.875 16.625 16.625 17.5 19.25 17.5" stroke="#9C5A2E" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.25 19.25C16.625 19.25 14.875 21 14.875 21.875C14.875 23.625 16.625 24.5 19.25 24.5" stroke="#9C5A2E" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.25 26.25C16.625 26.25 14.875 28 14.875 28.875C14.875 30.625 16.625 31.5 19.25 31.5" stroke="#9C5A2E" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.25 33.25C16.625 33.25 14.875 35 14.875 35.875C14.875 37.625 16.625 38.5 19.25 38.5" stroke="#9C5A2E" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M19.25 40.25C16.625 40.25 14.875 42 14.875 42.875C14.875 44.625 16.625 45.5 19.25 45.5" stroke="#9C5A2E" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 17.5H38.5" stroke="#9C5A2E" strokeOpacity="0.6" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 24.5H38.5" stroke="#9C5A2E" strokeOpacity="0.6" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 31.5H38.5" stroke="#9C5A2E" strokeOpacity="0.6" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 38.5H33.25" stroke="#9C5A2E" strokeOpacity="0.4" strokeWidth="1.3125" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type NotebookCardProps = {
  notebook: Notebook;
  collections: LibraryCollection[];
  onOpen: (notebook: Notebook) => void;
  onRename: (notebook: Notebook) => void;
  onToggleFavorite: (notebook: Notebook) => void;
  onMoveToCollection: (notebook: Notebook, collectionId: string) => void;
  onMoveToTrash: (notebook: Notebook) => void;
};

export function NotebookCard({ notebook, collections, onOpen, onRename, onToggleFavorite, onMoveToCollection, onMoveToTrash }: NotebookCardProps) {
  const contextMenu = useContextMenu();
  const pagesLabel = `${notebook.pageCount} ${notebook.pageCount === 1 ? "pagina" : "paginas"}`;

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={() => onOpen(notebook)}
        onContextMenu={contextMenu.open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(notebook);
          }
        }}
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#E8DDD4] bg-surface-card shadow-card transition hover:-translate-y-1 dark:border-border-subtle"
      >
        <div className="h-[3px] w-full shrink-0 bg-primary" aria-hidden="true" />

        <button
          type="button"
          aria-label={notebook.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          title={notebook.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          className={`absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm transition ${
            notebook.favorite ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          }`}
          style={{ color: "#EF4444" }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(notebook);
          }}
        >
          <HeartIcon filled={notebook.favorite} />
        </button>

        <div className="flex flex-1 flex-col items-center gap-3 px-4 py-8">
          <NotebookIllustration />
          <h3 className="text-center font-serif text-[15px] font-medium leading-[21px] text-[#2C1810] dark:text-text-primary">
            {notebook.title}
          </h3>
          <p className="text-center font-sans text-[11px] font-normal leading-[16.5px] text-text-secondary">
            {pagesLabel}
            {" \u00b7 "}
            {formatEditedAgo(notebook.updatedAt)}
          </p>
        </div>
      </article>

      <LibraryItemContextMenu
        collections={collections}
        contextMenu={contextMenu}
        favorite={notebook.favorite}
        onOpen={() => onOpen(notebook)}
        onRename={() => onRename(notebook)}
        onToggleFavorite={() => onToggleFavorite(notebook)}
        onMoveToCollection={(collectionId) => onMoveToCollection(notebook, collectionId)}
        onMoveToTrash={() => onMoveToTrash(notebook)}
      />
    </>
  );
}
