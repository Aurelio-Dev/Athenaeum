import { HeartIcon } from "../../components/ui/SharedIcons";
import { useContextMenu } from "../../hooks/useContextMenu";
import { formatEditedAgo } from "../../lib/relativeTime";
import type { Canvas, LibraryCollection } from "../../types/library";
import { LibraryItemContextMenu } from "../library/LibraryItemContextMenu";

// Grid de pontos decorativo da thumbnail, feito em CSS puro (radial-gradient
// repetido). E so um enfeite: o conteudo real do canvas nao e renderizado aqui.
export const dotGridBackground = {
  backgroundColor: "#EDE4D8",
  backgroundImage: "radial-gradient(circle, rgba(156, 90, 46, 0.22) 1px, transparent 1px)",
  backgroundSize: "12px 12px",
} as const;

type CanvasCardProps = {
  canvas: Canvas;
  collections: LibraryCollection[];
  onOpen: (canvas: Canvas) => void;
  onRename: (canvas: Canvas) => void;
  onToggleFavorite: (canvas: Canvas) => void;
  onMoveToCollection: (canvas: Canvas, collectionId: string) => void;
  onMoveToTrash: (canvas: Canvas) => void;
};

export function CanvasCard({ canvas, collections, onOpen, onRename, onToggleFavorite, onMoveToCollection, onMoveToTrash }: CanvasCardProps) {
  const contextMenu = useContextMenu();

  return (
    <>
      <article
        role="button"
        tabIndex={0}
        onClick={() => onOpen(canvas)}
        onContextMenu={contextMenu.open}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(canvas);
          }
        }}
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-[#E8DDD4] bg-surface-card shadow-card transition hover:-translate-y-1 dark:border-border-subtle"
      >
        <div className="h-[3px] w-full shrink-0 bg-primary" aria-hidden="true" />

        <button
          type="button"
          aria-label={canvas.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          title={canvas.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
          className={`absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm transition ${
            canvas.favorite ? "opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          }`}
          style={{ color: "#EF4444" }}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(canvas);
          }}
        >
          <HeartIcon filled={canvas.favorite} />
        </button>

        <div className="h-[120px] w-full" style={dotGridBackground} aria-hidden="true" />

        <div className="flex flex-1 flex-col gap-1 px-4 py-3">
          <h3 className="truncate font-serif text-[15px] font-medium leading-[21px] text-[#2C1810] dark:text-text-primary">
            {canvas.title}
          </h3>
          <p className="font-sans text-[11px] font-normal leading-[16.5px] text-text-secondary">
            {formatEditedAgo(canvas.updatedAt)}
          </p>
        </div>
      </article>

      <LibraryItemContextMenu
        collections={collections}
        contextMenu={contextMenu}
        favorite={canvas.favorite}
        onOpen={() => onOpen(canvas)}
        onRename={() => onRename(canvas)}
        onToggleFavorite={() => onToggleFavorite(canvas)}
        onMoveToCollection={(collectionId) => onMoveToCollection(canvas, collectionId)}
        onMoveToTrash={() => onMoveToTrash(canvas)}
      />
    </>
  );
}
