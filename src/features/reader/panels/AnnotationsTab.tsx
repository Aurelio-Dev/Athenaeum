import type { Annotation } from "../../../types/annotation";

type AnnotationsTabProps = {
  annotations: Annotation[];
  // Navega ate a pagina da anotacao (clique no item).
  onJumpToPage: (page: number) => void;
  // Remove a anotacao (highlight + nota).
  onDelete: (annotationId: string) => void;
};

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  );
}

// Highlight sem comentario: quadrado/checkbox em contorno.
function SquareOutlineIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3" />
    </svg>
  );
}

// Highlight com comentario: balao de comentario preenchido.
function CommentFilledIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4V5a2 2 0 0 1 2-2z" />
    </svg>
  );
}

// Aba "Anotacoes": lista de highlights/comentarios do documento. Clicar no item
// leva ate a pagina; o icone de lixeira remove. Ordenada por pagina e criacao.
export function AnnotationsTab({ annotations, onJumpToPage, onDelete }: AnnotationsTabProps) {
  if (annotations.length === 0) {
    return (
      <div className="px-5 py-10 text-center">
        <p className="text-sm font-semibold text-text-secondary">Nenhuma anotacao ainda</p>
        <p className="mt-2 text-sm text-text-subtle">Selecione um trecho do PDF e escolha Marcar ou Comentar.</p>
      </div>
    );
  }

  const sortedAnnotations = [...annotations].sort(
    (first, second) => first.page - second.page || first.createdAt.localeCompare(second.createdAt),
  );

  return (
    <div className="space-y-2 px-3 py-4">
      {sortedAnnotations.map((annotation) => (
        <div key={annotation.id} className="group relative rounded-lg border border-border-subtle bg-surface-card transition hover:border-primary">
          <button type="button" className="flex w-full items-start gap-3 px-4 py-3 pr-10 text-left" onClick={() => onJumpToPage(annotation.page)}>
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-tag-amber text-tag-amber-text">
              {annotation.note.length > 0 ? <CommentFilledIcon /> : <SquareOutlineIcon />}
            </span>
            <span className="min-w-0 flex-1">
              {annotation.note.length > 0 ? (
                <>
                  <span className="line-clamp-1 block text-xs italic text-text-subtle">&ldquo;{annotation.selectedText}&rdquo;</span>
                  <span className="mt-1 line-clamp-3 block text-sm text-text-primary">{annotation.note}</span>
                </>
              ) : (
                <span className="line-clamp-3 block text-sm text-text-primary">{annotation.selectedText}</span>
              )}
              <span className="mt-2 inline-block rounded bg-surface-muted px-2 py-0.5 text-xs font-semibold text-text-subtle">p. {annotation.page}</span>
            </span>
          </button>
          <button
            type="button"
            aria-label="Remover anotacao"
            title="Remover anotacao"
            className="absolute right-2 top-2 rounded-md p-1.5 text-text-subtle opacity-0 transition hover:bg-status-red hover:text-status-red-text focus:opacity-100 group-hover:opacity-100"
            onClick={() => onDelete(annotation.id)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
