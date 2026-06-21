import { IconButton } from "../../components/IconButton";
import type { SortMode, StatusFilter, ViewMode } from "../../types/library";

type LibraryToolbarProps = {
  statusFilter: StatusFilter;
  sortMode: SortMode;
  viewMode: ViewMode;
  compact?: boolean;
  onStatusFilterChange: (value: StatusFilter) => void;
  onSortModeChange: (value: SortMode) => void;
  onViewModeChange: (value: ViewMode) => void;
  onAddPdf: () => void;
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

function ListIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="4" x2="20" y1="7" y2="7" />
      <line x1="4" x2="20" y1="12" y2="12" />
      <line x1="4" x2="20" y1="17" y2="17" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <line x1="12" x2="12" y1="5" y2="19" />
      <line x1="5" x2="19" y1="12" y2="12" />
    </svg>
  );
}

export function LibraryToolbar({
  statusFilter,
  sortMode,
  viewMode,
  compact = false,
  onStatusFilterChange,
  onSortModeChange,
  onViewModeChange,
  onAddPdf,
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

      <div className="flex rounded-lg border border-border-muted bg-surface-muted p-1">
        <IconButton label="Visualizacao em lista" variant={viewMode === "list" ? "selected" : "ghost"} onClick={() => onViewModeChange("list")}>
          <ListIcon />
        </IconButton>
        <IconButton label="Visualizacao em grade" variant={viewMode === "grid" ? "selected" : "ghost"} onClick={() => onViewModeChange("grid")}>
          <GridIcon />
        </IconButton>
      </div>

      {compact ? null : (
        <button
          type="button"
          onClick={onAddPdf}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
        >
          <PlusIcon />
          Adicionar PDF
        </button>
      )}
    </div>
  );
}
