import type { SortMode, StatusFilter } from "../../types/library";

type LibraryToolbarProps = {
  statusFilter: StatusFilter;
  sortMode: SortMode;
  compact?: boolean;
  onStatusFilterChange: (value: StatusFilter) => void;
  onSortModeChange: (value: SortMode) => void;
};

function FilterIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="4" x2="20" y1="7" y2="7" />
      <line x1="8" x2="16" y1="12" y2="12" />
      <line x1="11" x2="13" y1="17" y2="17" />
    </svg>
  );
}

export function LibraryToolbar({
  statusFilter,
  sortMode,
  compact = false,
  onStatusFilterChange,
  onSortModeChange,
}: LibraryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {compact ? null : (
        <>
          <label className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm text-text-secondary transition hover:border-border-strong">
            <FilterIcon />
            <select
              value={statusFilter}
              onChange={(event) => onStatusFilterChange(event.target.value as StatusFilter)}
              className="cursor-pointer border-0 bg-transparent text-sm text-text-primary outline-none"
            >
              <option value="all">Todos os status</option>
              <option value="in-progress">Em progresso</option>
              <option value="completed">Concluido</option>
              <option value="not-started">Nao iniciado</option>
              <option value="error">Erro</option>
            </select>
          </label>

          <label className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm text-text-secondary transition hover:border-border-strong">
            Ordenar:
            <select
              value={sortMode}
              onChange={(event) => onSortModeChange(event.target.value as SortMode)}
              className="cursor-pointer border-0 bg-transparent text-sm font-semibold text-text-primary outline-none"
            >
              <option value="recentes">Recentes</option>
              <option value="titulo">Titulo</option>
              <option value="progresso">Progresso</option>
            </select>
          </label>
        </>
      )}
    </div>
  );
}
