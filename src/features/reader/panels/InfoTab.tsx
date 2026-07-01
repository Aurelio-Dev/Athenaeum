import { useEffect, useMemo, useRef, useState } from "react";
import { getSubjectTagTone, toneClassNames } from "../../../styles/designTokens";
import type { LibraryDocument, SubjectTag } from "../../../types/library";
import { formatReadingTime } from "../useReadingTimer";

type InfoTabProps = {
  document: LibraryDocument;
  notesText: string;
  onNotesChange: (notes: string) => void;
  availableTags: SubjectTag[];
  onAddTag: (tag: SubjectTag) => void;
  onRemoveTag: (tag: SubjectTag) => void;
  progress: number;
  timeSpentSeconds: number;
};

function formatAuthors(authors: string[]) {
  return authors.length > 4 ? `${authors.slice(0, 4).join(", ")} et al.` : authors.join(", ");
}

function normalizeTag(tag: string) {
  return tag.trim().replace(/\s+/g, " ");
}

export function InfoTab({
  document,
  notesText,
  onNotesChange,
  availableTags,
  onAddTag,
  onRemoveTag,
  progress,
  timeSpentSeconds,
}: InfoTabProps) {
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const documentTagKeys = useMemo(() => new Set(document.tags.map((tag) => tag.toLocaleLowerCase("pt-BR"))), [document.tags]);
  const addableTags = availableTags.filter((tag) => !documentTagKeys.has(tag.toLocaleLowerCase("pt-BR")));
  const normalizedTagQuery = normalizeTag(newTagName).toLocaleLowerCase("pt-BR");
  const suggestedTags = addableTags.filter((tag) => tag.toLocaleLowerCase("pt-BR").includes(normalizedTagQuery));

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setIsAddingTag(false);
        setNewTagName("");
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (isAddingTag) {
      inputRef.current?.focus();
    }
  }, [isAddingTag]);

  function commitTag(tag: SubjectTag) {
    const normalizedTag = normalizeTag(tag);

    if (normalizedTag.length === 0) {
      return;
    }

    const existingTag = addableTags.find((availableTag) => availableTag.toLocaleLowerCase("pt-BR") === normalizedTag.toLocaleLowerCase("pt-BR"));
    onAddTag(existingTag ?? normalizedTag);
    setNewTagName("");
    setIsAddingTag(false);
  }

  function commitNewTag() {
    commitTag(newTagName);
  }

  return (
    <div className="space-y-6 px-5 py-5">
      <section>
        <p className="text-xs font-bold uppercase tracking-wider text-text-subtle">Titulo</p>
        <p className="mt-2 text-sm font-semibold text-text-primary">{document.title}</p>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-wider text-text-subtle">Autor(es)</p>
        <p className="mt-2 text-sm text-text-secondary">{formatAuthors(document.authors) || "Autor nao identificado"}</p>
      </section>

      <section>
        <p className="text-xs font-bold uppercase tracking-wider text-text-subtle">Tags</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {document.tags.map((tag) => {
            const tone = getSubjectTagTone(tag);

            return (
              <span key={tag} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold ${toneClassNames[tone].badge}`}>
                {tag}
                <button type="button" className="rounded px-1 hover:bg-white/50" aria-label={`Remover tag ${tag}`} onClick={() => onRemoveTag(tag)}>
                  x
                </button>
              </span>
            );
          })}

          {!isAddingTag ? (
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-border-muted px-2.5 py-1 text-xs font-bold text-primary hover:bg-primary-soft"
              onClick={() => setIsAddingTag(true)}
            >
              +
            </button>
          ) : null}

          {isAddingTag ? (
            <div ref={dropdownRef} className="relative w-full min-w-0">
              <input
                ref={inputRef}
                value={newTagName}
                onChange={(event) => setNewTagName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitNewTag();
                  }

                  if (event.key === "Escape") {
                    setIsAddingTag(false);
                    setNewTagName("");
                  }
                }}
                className="w-full rounded-md border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary"
                placeholder="Adicionar tag"
              />

              <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-10 max-h-44 overflow-y-auto rounded-lg border border-border-subtle bg-surface-elevated p-1 shadow-2xl">
                {suggestedTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface-muted"
                    onClick={() => commitTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
                <button
                  type="button"
                  className="block w-full rounded-md px-3 py-2 text-left text-sm font-semibold text-primary hover:bg-primary-soft disabled:cursor-not-allowed disabled:text-text-subtle disabled:hover:bg-transparent"
                  disabled={normalizeTag(newTagName).length === 0}
                  onClick={commitNewTag}
                >
                  + Criar tag nova{normalizeTag(newTagName).length > 0 ? ` "${normalizeTag(newTagName)}"` : ""}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <label className="block">
        <span className="text-xs font-bold uppercase tracking-wider text-text-subtle">Descricao</span>
        <textarea
          className="mt-3 h-44 w-full resize-none rounded-lg border border-border-muted bg-surface-panel px-4 py-3 text-sm leading-6 text-text-primary outline-none focus:border-primary"
          value={notesText}
          placeholder="Adicione uma descricao..."
          onChange={(event) => onNotesChange(event.target.value)}
        />
        <span className="mt-2 block text-xs text-text-subtle">Sera preenchida automaticamente em uma versao futura</span>
      </label>

      <section>
        <p className="text-xs font-bold uppercase tracking-wider text-text-subtle">Tempo de leitura</p>
        <p className="mt-2 text-sm font-semibold text-text-primary">{formatReadingTime(timeSpentSeconds)}</p>
      </section>

      <section>
        <div className="flex items-center justify-between text-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-text-subtle">Progresso</span>
          <span className="font-bold text-primary">{progress}%</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
        </div>
      </section>
    </div>
  );
}
