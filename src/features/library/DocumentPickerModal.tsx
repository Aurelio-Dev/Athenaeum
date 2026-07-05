import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { LibraryDocument } from "../../types/library";

type DocumentPickerModalProps = {
  // Lista ja carregada pelo LibraryView (snapshot da biblioteca) — o filtro de
  // busca roda em memoria sobre ela, sem query nova por tecla.
  documents: LibraryDocument[];
  // Ids ja vinculados ao caderno. O pai atualiza este Set apos cada onPick, sem
  // fechar o modal — o item vira "Já vinculado" na mesma sessao.
  linkedDocumentIds: Set<string>;
  onPick: (documentId: string) => void;
  onClose: () => void;
};

function formatAuthors(authors: string[]) {
  return authors.length > 0 ? authors.join(", ") : "Sem autor";
}

export function DocumentPickerModal({ documents, linkedDocumentIds, onPick, onClose }: DocumentPickerModalProps) {
  const [searchTerm, setSearchTerm] = useState("");

  // Esc fecha o modal.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const visibleDocuments = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      return documents;
    }
    return documents.filter((document) => {
      const haystack = `${document.title} ${document.authors.join(" ")}`.toLowerCase();
      return haystack.includes(term);
    });
  }, [documents, searchTerm]);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6"
      role="presentation"
      onMouseDown={onClose}
    >
      <section
        className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-surface-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Vincular PDF"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-6 py-4">
          <h2 className="text-lg font-bold text-text-primary">Vincular PDF</h2>
          <button
            type="button"
            aria-label="Fechar"
            title="Fechar"
            className="rounded-md p-1.5 text-text-subtle transition hover:bg-surface-muted hover:text-text-primary"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <line x1="18" x2="6" y1="6" y2="18" />
              <line x1="6" x2="18" y1="6" y2="18" />
            </svg>
          </button>
        </header>

        <div className="border-b border-border-subtle px-6 py-3">
          <label className="flex items-center gap-2 rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-text-subtle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" x2="16.65" y1="21" y2="16.65" />
            </svg>
            <input
              autoFocus
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Buscar por título ou autor..."
              aria-label="Buscar documento"
              className="min-w-0 flex-1 border-0 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-subtle"
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {visibleDocuments.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-text-secondary">Nenhum documento encontrado.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {visibleDocuments.map((document) => {
                const isLinked = linkedDocumentIds.has(document.id);

                return (
                  <li key={document.id}>
                    <button
                      type="button"
                      disabled={isLinked}
                      onClick={() => onPick(document.id)}
                      className={`flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition ${
                        isLinked ? "cursor-default opacity-55" : "hover:bg-surface-muted"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{document.title}</span>
                        {isLinked ? (
                          <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-text-secondary">
                            Já vinculado
                          </span>
                        ) : null}
                      </div>
                      <span className="truncate text-xs text-text-secondary">{formatAuthors(document.authors)}</span>
                      <span className="truncate text-[11px] text-text-subtle">
                        {document.year} · {document.collection}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>,
    window.document.body,
  );
}
