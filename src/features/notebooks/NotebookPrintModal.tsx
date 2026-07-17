import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { NotebookPage } from "../../types/library";

type NotebookPrintModalProps = {
  pages: NotebookPage[];
  currentPageId: number | null;
  isPreparing: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (pageIds: number[]) => void;
};

function pageDisplayTitle(page: NotebookPage) {
  return page.title?.trim() || `Página sem título ${page.position}`;
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

export function NotebookPrintModal({
  pages,
  currentPageId,
  isPreparing,
  error,
  onCancel,
  onConfirm,
}: NotebookPrintModalProps) {
  const [selectedPageIds, setSelectedPageIds] = useState(
    () => new Set(currentPageId === null ? [] : [currentPageId]),
  );
  const selectedCount = selectedPageIds.size;

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (!isPreparing) {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [isPreparing, onCancel]);

  function togglePage(pageId: number) {
    setSelectedPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }

  function selectCurrentPage() {
    setSelectedPageIds(new Set(currentPageId === null ? [] : [currentPageId]));
  }

  function confirmSelection() {
    if (selectedCount === 0 || isPreparing) {
      return;
    }

    onConfirm(pages.filter((page) => selectedPageIds.has(page.id)).map((page) => page.id));
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6"
      role="presentation"
      onMouseDown={() => {
        if (!isPreparing) {
          onCancel();
        }
      }}
    >
      <section
        className="flex max-h-[min(760px,calc(100vh-3rem))] w-full max-w-lg flex-col rounded-xl bg-surface-panel text-text-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notebook-print-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-6 py-5">
          <div>
            <h2 id="notebook-print-title" className="text-lg font-bold">Imprimir Caderno</h2>
            <p className="mt-1 text-sm text-text-secondary">Escolha as páginas que irão para o PDF.</p>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onCancel}
            disabled={isPreparing}
            aria-label="Fechar"
            title="Fechar"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-primary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={() => setSelectedPageIds(new Set(pages.map((page) => page.id)))}
              disabled={isPreparing}
            >
              Selecionar todas
            </button>
            <button
              type="button"
              className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-bold text-text-secondary transition hover:border-primary hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={selectCurrentPage}
              disabled={currentPageId === null || isPreparing}
            >
              Só a página atual
            </button>
          </div>

          <fieldset className="min-h-0 overflow-y-auto rounded-lg border border-border-subtle bg-surface-card p-2">
            <legend className="sr-only">Páginas para imprimir</legend>
            <div className="grid gap-1">
              {pages.map((page) => (
                <label
                  key={page.id}
                  className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2.5 transition hover:bg-surface-muted"
                >
                  <input
                    type="checkbox"
                    checked={selectedPageIds.has(page.id)}
                    disabled={isPreparing}
                    onChange={() => togglePage(page.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-text-primary">{pageDisplayTitle(page)}</span>
                    <span className="block text-xs text-text-secondary">Página {page.position}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {error ? (
            <div className="rounded-lg border border-status-red bg-status-red-soft px-4 py-3 text-sm font-medium text-status-red-text">
              {error}
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-border-subtle px-6 py-4">
          <span className="text-xs font-semibold text-text-secondary">
            {selectedCount} {selectedCount === 1 ? "página selecionada" : "páginas selecionadas"}
          </span>
          <div className="flex gap-3">
            <button
              type="button"
              className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              onClick={onCancel}
              disabled={isPreparing}
            >
              Cancelar
            </button>
            <button
              type="button"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              onClick={confirmSelection}
              disabled={selectedCount === 0 || isPreparing}
            >
              {isPreparing ? "Preparando..." : "Imprimir"}
            </button>
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
