import { type KeyboardEvent, useEffect, useState } from "react";
import { TAG_COLOR_TOKEN_NAMES, TAG_COLOR_TOKENS, type TagColorToken } from "../lib/tagColors";
import type { LibraryCollection } from "../types/library";
import { TagColorPicker } from "./ui/TagColorPicker";

type NewCollectionPayload = {
  name: string;
  description: string;
  color: string;
};

type NewCollectionModalProps = {
  // Colecao existente => modo edicao (campos preenchidos, textos "Salvar").
  // Ausente => modo criacao.
  collection?: LibraryCollection;
  onClose: () => void;
  onCreateCollection: (collection: NewCollectionPayload) => Promise<void>;
};

const defaultColorToken: TagColorToken = "violet";

// A cor da colecao e persistida como hex (ex.: "#7C3AED"); mapeia de volta
// para o token da paleta ao editar, caindo no padrao se nao encontrar.
function findColorToken(color: string): TagColorToken {
  const match = TAG_COLOR_TOKEN_NAMES.find((token) => TAG_COLOR_TOKENS[token].bg.toLowerCase() === color.toLowerCase());
  return match ?? defaultColorToken;
}

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

export function NewCollectionModal({ collection, onClose, onCreateCollection }: NewCollectionModalProps) {
  const isEditing = Boolean(collection);
  const [name, setName] = useState(collection?.name ?? "");
  const [description, setDescription] = useState(collection?.description ?? "");
  const [selectedColorToken, setSelectedColorToken] = useState<TagColorToken>(
    collection ? findColorToken(collection.color) : defaultColorToken,
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const trimmedName = name.trim();
  const canCreate = trimmedName.length > 0 && !isSubmitting;

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onClose]);

  function preventAccidentalSubmit(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" && !(event.target instanceof HTMLTextAreaElement)) {
      event.preventDefault();
    }
  }

  async function submitCollection() {
    if (!canCreate) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onCreateCollection({
        name: trimmedName,
        description,
        color: TAG_COLOR_TOKENS[selectedColorToken].bg,
      });
      onClose();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
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
        className="material-surface-overlay w-full max-w-lg rounded-lg bg-surface-panel text-text-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-collection-title"
        onKeyDown={preventAccidentalSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-6 py-5">
          <h2 id="new-collection-title" className="text-lg font-bold">
            {isEditing ? "Editar coleção" : "Nova coleção"}
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

        <div className="grid gap-5 px-6 py-5">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-text-primary">Nome</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex: Filosofia da Mente"
              className="rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-subtle focus:border-primary focus:ring-2 focus:ring-primary/20"
              autoFocus
            />
            {error ? <span className="text-sm font-semibold text-status-red-text">{error}</span> : null}
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-semibold text-text-primary">Descrição</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Uma linha sobre o tema desta coleção..."
              rows={3}
              className="resize-none rounded-lg border border-border-muted bg-surface-panel px-3 py-2 text-sm leading-6 text-text-primary outline-none placeholder:text-text-subtle focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
          </label>

          <div className="grid gap-3">
            <span className="text-sm font-semibold text-text-primary">Cor</span>
            <TagColorPicker selectedToken={selectedColorToken} onSelect={setSelectedColorToken} />
          </div>
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
            onClick={() => void submitCollection()}
            disabled={!canCreate}
          >
            {isSubmitting ? "Salvando..." : isEditing ? "Salvar" : "Criar coleção"}
          </button>
        </footer>
      </section>
    </div>
  );
}
