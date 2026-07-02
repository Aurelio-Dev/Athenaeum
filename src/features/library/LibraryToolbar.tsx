import { useEffect, useRef, useState } from "react";
import type { SortMode, ViewMode } from "../../types/library";

type LibraryToolbarProps = {
  sortMode: SortMode;
  viewMode: ViewMode;
  compact?: boolean;
  onSortModeChange: (value: SortMode) => void;
  onViewModeChange: (value: ViewMode) => void;
};

const sortModeLabels: Record<SortMode, string> = {
  recentes: "Recente",
  titulo: "Título",
  progresso: "Progresso",
};

const sortModes: SortMode[] = ["recentes", "titulo", "progresso"];

function ChevronDownIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {/* Marcadores a esquerda de cada linha (estilo "list" do Figma). */}
      <line x1="9" x2="20" y1="6" y2="6" />
      <line x1="9" x2="20" y1="12" y2="12" />
      <line x1="9" x2="20" y1="18" y2="18" />
      <circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

const viewModes: Array<{ mode: ViewMode; label: string }> = [
  { mode: "grid", label: "Visualizar em grade" },
  { mode: "list", label: "Visualizar em lista" },
];

export function LibraryToolbar({ sortMode, viewMode, compact = false, onSortModeChange, onViewModeChange }: LibraryToolbarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleMouseDown(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    window.document.addEventListener("mousedown", handleMouseDown);
    return () => window.document.removeEventListener("mousedown", handleMouseDown);
  }, [isOpen]);

  if (compact) {
    return null;
  }

  function selectSortMode(value: SortMode) {
    onSortModeChange(value);
    setIsOpen(false);
  }

  return (
    <div className="flex items-center gap-2">
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setIsOpen((currentIsOpen) => !currentIsOpen)}
          className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-[12px] font-normal leading-[18px] text-[#2C1810] dark:text-text-primary"
        >
          {sortModeLabels[sortMode]}
          <ChevronDownIcon />
        </button>

        {isOpen ? (
          <div className="absolute top-full left-0 z-10 mt-1 min-w-full rounded-lg border border-border-muted bg-surface-panel p-1 shadow-lg">
            {sortModes.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => selectSortMode(mode)}
                className={`block w-full cursor-pointer rounded-md px-4 py-2 text-left text-sm hover:bg-surface-muted ${
                  mode === sortMode ? "font-semibold text-primary" : "text-text-primary"
                }`}
              >
                {sortModeLabels[mode]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* Controle segmentado grade/lista, como no Figma. */}
      <div className="flex items-center rounded-lg border border-border-muted bg-surface-panel p-0.5">
        {viewModes.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => onViewModeChange(mode)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition ${
              viewMode === mode ? "bg-primary text-text-inverse" : "text-text-secondary hover:text-text-primary"
            }`}
            aria-label={label}
            title={label}
            aria-pressed={viewMode === mode}
          >
            {mode === "grid" ? <GridIcon /> : <ListIcon />}
          </button>
        ))}
      </div>
    </div>
  );
}
