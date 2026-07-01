import { type KeyboardEvent, useEffect, useState } from "react";
import { TAG_COLOR_TOKENS, type TagColorToken } from "../lib/tagColors";

type NewCollectionPayload = {
  name: string;
  description: string;
  color: string;
};

type NewCollectionModalProps = {
  onClose: () => void;
  onCreateCollection: (collection: NewCollectionPayload) => Promise<void>;
};

const colorOrder: TagColorToken[] = ["violet", "indigo", "blue", "teal", "green", "amber", "rose", "red", "slate"];
const defaultColorToken: TagColorToken = "violet";

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Erro desconhecido.";
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

export function NewCollectionModal({ onClose, onCreateCollection }: NewCollectionModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedColorToken, setSelectedColorToken] = useState<TagColorToken>(defaultColorToken);
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
        className="w-full max-w-lg rounded-lg bg-surface-panel text-text-primary shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-collection-title"
        onKeyDown={preventAccidentalSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-6 py-5">
          <h2 id="new-collection-title" className="text-lg font-bold">
            Nova coleção
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
            <div className="flex flex-wrap items-center gap-4">
              {colorOrder.map((token) => {
                const selected = token === selectedColorToken;

                return (
                  <button
                    key={token}
                    type="button"
                    className="flex h-9 w-9 items-center justify-center rounded-full transition hover:scale-105"
                    onClick={() => setSelectedColorToken(token)}
                    aria-label={`Selecionar cor ${token}`}
                    aria-pressed={selected}
                  >
                    <span
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${
                        selected ? "ring-2 ring-white ring-offset-2 ring-offset-surface-panel" : ""
                      }`}
                      style={{ backgroundColor: TAG_COLOR_TOKENS[token].bg }}
                    >
                      {selected ? <CheckIcon /> : null}
                    </span>
                  </button>
                );
              })}
            </div>
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
            {isSubmitting ? "Criando..." : "Criar coleção"}
          </button>
        </footer>
      </section>
    </div>
  );
}
