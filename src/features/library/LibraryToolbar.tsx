import { useEffect, useRef, useState } from "react";
import type { SortMode } from "../../types/library";

type LibraryToolbarProps = {
  sortMode: SortMode;
  compact?: boolean;
  onSortModeChange: (value: SortMode) => void;
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

export function LibraryToolbar({ sortMode, compact = false, onSortModeChange }: LibraryToolbarProps) {
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
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((currentIsOpen) => !currentIsOpen)}
        className="flex items-center gap-2 rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm font-semibold text-text-primary"
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
  );
}
