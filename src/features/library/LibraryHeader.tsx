type LibraryHeaderProps = {
  title: string;
  count: number;
  // Descricao da colecao — renderiza so quando vier preenchida.
  description?: string;
  // Presente apenas em rotas de colecao: mostra o lapis ao lado do titulo
  // para editar nome/descricao/cor.
  onEdit?: () => void;
};

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function LibraryHeader({ title, count, description, onEdit }: LibraryHeaderProps) {
  return (
    <div className="min-w-64 flex-1">
      <div className="flex items-center gap-3">
        <h1 className="truncate text-[32px] font-bold leading-tight tracking-tight text-text-primary">{title}</h1>
        {onEdit ? (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-subtle bg-surface-panel text-text-secondary shadow-sm transition hover:text-text-primary"
            aria-label="Editar coleção"
            title="Editar coleção"
          >
            <PencilIcon />
          </button>
        ) : null}
      </div>
      {description ? <p className="mt-1 text-sm text-text-secondary">{description}</p> : null}
      <p className="mt-2 text-sm text-text-secondary">
        {count} {count === 1 ? "item" : "itens"}
      </p>
    </div>
  );
}
