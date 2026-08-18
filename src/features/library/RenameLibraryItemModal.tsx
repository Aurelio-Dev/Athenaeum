import { type KeyboardEvent, useEffect, useState } from "react";

type RenameLibraryItemModalProps = {
  title: string;
  initialName: string;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Erro desconhecido.";
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

export function RenameLibraryItemModal({ title, initialName, onClose, onRename }: RenameLibraryItemModalProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedName = name.trim();
  const canSubmit = trimmedName.length > 0 && !isSubmitting;

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onClose]);

  function preventEnterSubmit(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  async function submit() {
    if (!canSubmit) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onRename(trimmedName);
      onClose();
    } catch (renameError) {
      setError(getErrorMessage(renameError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay-modal p-6"
      role="presentation"
      onMouseDown={() => {
        if (!isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        className="w-full max-w-md rounded-lg bg-surface-panel text-text-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-library-item-title"
        onKeyDown={preventEnterSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-6 py-5">
          <h2 id="rename-library-item-title" className="text-lg font-bold">
            {title}
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Fechar"
            title="Fechar"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="grid gap-2 px-6 py-5">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-text-primary">Nome</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-subtle focus:border-primary focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
          </label>
          {error ? <span className="text-sm font-semibold text-status-red-text">{error}</span> : null}
        </div>

        <footer className="flex justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button
            type="button"
            className="rounded-lg border border-border-muted px-4 py-2 text-sm font-semibold text-text-secondary transition hover:bg-surface-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
            onClick={onClose}
            disabled={isSubmitting}
          >
            Cancelar
          </button>
          <button
            type="button"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {isSubmitting ? "Salvando..." : "Salvar"}
          </button>
        </footer>
      </section>
    </div>
  );
}
