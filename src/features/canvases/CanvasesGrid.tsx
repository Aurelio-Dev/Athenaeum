import type { Canvas, LibraryCollection } from "../../types/library";
import { CanvasCard, dotGridBackground } from "./CanvasCard";

type CanvasesGridProps = {
  canvases: Canvas[];
  collections: LibraryCollection[];
  isLoading: boolean;
  hasError: boolean;
  onCreate: () => void;
  onOpen: (canvas: Canvas) => void;
  onRename: (canvas: Canvas) => void;
  onToggleFavorite: (canvas: Canvas) => void;
  onMoveToCollection: (canvas: Canvas, collectionId: string) => void;
  onMoveToTrash: (canvas: Canvas) => void;
};

export function CanvasesGrid({ canvases, collections, isLoading, hasError, onCreate, onOpen, onRename, onToggleFavorite, onMoveToCollection, onMoveToTrash }: CanvasesGridProps) {
  if (isLoading) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
        <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-secondary">
          Carregando quadros
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
        <div className="rounded-full bg-status-red px-4 py-2 text-sm font-semibold text-status-red-text">
          Nao foi possivel carregar os quadros.
        </div>
      </div>
    );
  }

  if (canvases.length === 0) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
        <div className="h-16 w-24 rounded-lg opacity-60" style={dotGridBackground} aria-hidden="true" />
        <h2 className="mt-4 font-sans text-base font-semibold text-text-secondary">Nenhum quadro ainda</h2>
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
        >
          Criar primeiro quadro
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
      {canvases.map((canvas) => (
        <CanvasCard
          key={canvas.id}
          canvas={canvas}
          collections={collections}
          onOpen={onOpen}
          onRename={onRename}
          onToggleFavorite={onToggleFavorite}
          onMoveToCollection={onMoveToCollection}
          onMoveToTrash={onMoveToTrash}
        />
      ))}
    </div>
  );
}
