import { useEffect, useRef, useState } from "react";

type NotePopoverProps = {
  // Trecho destacado, mostrado como titulo do popup.
  selectedText: string;
  // Nota atual (vazia ao comentar pela primeira vez).
  initialNote: string;
  onCancel: () => void;
  // Persiste a nota. Deve LANCAR em caso de falha para o popup manter o texto e
  // avisar o usuario (a nota nunca e perdida silenciosamente).
  onSave: (note: string) => Promise<void>;
  // Remove a anotacao inteira (highlight + nota). Deve LANCAR em caso de falha.
  onDelete: () => Promise<void>;
};

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

// Popup para escrever/editar o comentario de um highlight. Salva de forma
// imediata e so fecha apos o banco confirmar; se falhar, fica aberto com o texto
// intacto e mostra erro para o usuario tentar de novo.
export function NotePopover({ selectedText, initialNote, onCancel, onSave, onDelete }: NotePopoverProps) {
  const [note, setNote] = useState(initialNote);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isBusy = isSaving || isDeleting;

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onCancel]);

  async function handleSave() {
    if (isBusy) {
      return;
    }

    setIsSaving(true);
    setErrorMessage("");

    try {
      await onSave(note);
      // Em caso de sucesso, o componente pai fecha o popup.
    } catch (error) {
      console.warn("Nao foi possivel salvar a nota.", error);
      setErrorMessage("Nao foi possivel salvar a nota. Tente novamente.");
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (isBusy) {
      return;
    }

    setIsDeleting(true);
    setErrorMessage("");

    try {
      await onDelete();
      // Em caso de sucesso, o componente pai fecha o popup.
    } catch (error) {
      console.warn("Nao foi possivel remover a anotacao.", error);
      setErrorMessage("Nao foi possivel remover a anotacao. Tente novamente.");
      setIsDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-overlay-modal px-6 pt-[12vh]" role="presentation" onMouseDown={onCancel}>
      <div
        className="w-full max-w-md rounded-2xl bg-surface-panel p-5 shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Anotacao"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary" title={selectedText}>
            &ldquo;{selectedText}&rdquo;
          </p>
          <button type="button" aria-label="Fechar" className="rounded-md p-1 text-text-subtle hover:bg-surface-muted" onClick={onCancel}>
            <CloseIcon />
          </button>
        </header>

        <textarea
          ref={textareaRef}
          className="mt-4 h-32 w-full resize-none rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm leading-6 text-text-primary outline-none focus:border-primary"
          value={note}
          placeholder="Escreva sua nota..."
          onChange={(event) => setNote(event.target.value)}
        />

        {errorMessage.length > 0 ? (
          <p className="mt-3 rounded-lg bg-status-red px-3 py-2 text-sm font-semibold text-status-red-text">{errorMessage}</p>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={isBusy}
            className="rounded-lg px-3 py-2 text-sm font-semibold text-status-red-text hover:bg-status-red disabled:cursor-not-allowed disabled:text-text-subtle disabled:hover:bg-transparent"
            onClick={() => void handleDelete()}
          >
            Remover
          </button>
          <div className="flex items-center gap-2">
            <button type="button" disabled={isBusy} className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-muted disabled:cursor-not-allowed" onClick={onCancel}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={isBusy}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle disabled:shadow-none"
              onClick={() => void handleSave()}
            >
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
