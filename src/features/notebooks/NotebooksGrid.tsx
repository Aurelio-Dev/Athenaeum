import type { LibraryCollection, Notebook } from "../../types/library";
import { NotebookCard, NotebookIllustration } from "./NotebookCard";

type NotebooksGridProps = {
  notebooks: Notebook[];
  collections: LibraryCollection[];
  isLoading: boolean;
  hasError: boolean;
  onCreate: () => void;
  onOpen: (notebook: Notebook) => void;
  onRename: (notebook: Notebook) => void;
  onToggleFavorite: (notebook: Notebook) => void;
  onMoveToCollection: (notebook: Notebook, collectionId: string) => void;
  onMoveToTrash: (notebook: Notebook) => void;
};

export function NotebooksGrid({ notebooks, collections, isLoading, hasError, onCreate, onOpen, onRename, onToggleFavorite, onMoveToCollection, onMoveToTrash }: NotebooksGridProps) {
  if (isLoading) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
        <div className="rounded-full bg-surface-muted px-4 py-2 text-sm font-semibold text-text-secondary">
          Carregando cadernos
        </div>
      </div>
    );
  }

  if (hasError) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
        <div className="rounded-full bg-status-red px-4 py-2 text-sm font-semibold text-status-red-text">
          Nao foi possivel carregar os cadernos.
        </div>
      </div>
    );
  }

  if (notebooks.length === 0) {
    return (
      <div className="flex h-full min-h-96 flex-col items-center justify-center text-center">
        <span className="opacity-50">
          <NotebookIllustration size={64} />
        </span>
        <h2 className="mt-4 font-serif text-base font-medium text-text-primary">Nenhum caderno ainda</h2>
        <button
          type="button"
          onClick={onCreate}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
        >
          Criar primeiro caderno
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
      {notebooks.map((notebook) => (
        <NotebookCard
          key={notebook.id}
          notebook={notebook}
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
