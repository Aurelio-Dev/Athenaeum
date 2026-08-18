import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { TagPill } from "./TagPill";
import type { SubjectTag } from "../../types/library";

type TagInputProps = {
  availableTags: SubjectTag[];
  selectedTags: SubjectTag[];
  onSelectedTagsChange: (tags: SubjectTag[]) => void;
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
  // Elemento do modal. O dropdown so fecha em clique FORA deste limite — clicar
  // dentro do modal (inclusive rolar) mantem o dropdown aberto. Se ausente,
  // usa o proprio campo como limite.
  boundaryRef?: RefObject<HTMLElement>;
  placeholder?: string;
};

function normalizeTag(tag: string) {
  return tag.trim().replace(/\s+/g, " ");
}

function mergeUniqueTags(tags: SubjectTag[]) {
  const seenTags = new Set<string>();
  return tags.filter((tag) => {
    const key = tag.toLocaleLowerCase("pt-BR");

    if (seenTags.has(key)) {
      return false;
    }

    seenTags.add(key);
    return true;
  });
}

function RemoveIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

export function TagInput({
  availableTags,
  selectedTags,
  onSelectedTagsChange,
  onAvailableTagsChange,
  boundaryRef,
  placeholder = "Adicionar tag...",
}: TagInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Fecha o dropdown apenas quando o clique cai FORA do modal (ou do campo, se
  // nao houver boundary). Rolagem nao dispara mousedown, entao scroll dentro do
  // modal nunca fecha — que e exatamente o bug de onClickOutside a evitar.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      const boundary = boundaryRef?.current ?? containerRef.current;

      if (boundary && event.target instanceof Node && !boundary.contains(event.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [isOpen, boundaryRef]);

  const normalizedQuery = normalizeTag(query);

  const suggestions = useMemo(() => {
    const loweredQuery = normalizedQuery.toLocaleLowerCase("pt-BR");
    const selectedLookup = new Set(selectedTags.map((tag) => tag.toLocaleLowerCase("pt-BR")));

    return availableTags.filter((tag) => {
      const lowered = tag.toLocaleLowerCase("pt-BR");
      return !selectedLookup.has(lowered) && (loweredQuery.length === 0 || lowered.includes(loweredQuery));
    });
  }, [availableTags, selectedTags, normalizedQuery]);

  const hasExactMatch = availableTags.some((tag) => tag.toLocaleLowerCase("pt-BR") === normalizedQuery.toLocaleLowerCase("pt-BR"));
  const canCreate = normalizedQuery.length > 0 && !hasExactMatch;

  function openDropdown() {
    setIsOpen(true);
  }

  function selectTag(tag: SubjectTag) {
    if (!selectedTags.some((selectedTag) => selectedTag.toLocaleLowerCase("pt-BR") === tag.toLocaleLowerCase("pt-BR"))) {
      onSelectedTagsChange([...selectedTags, tag]);
    }

    setQuery("");
    setIsOpen(false);
  }

  function createTag() {
    if (!canCreate) {
      return;
    }

    onAvailableTagsChange(mergeUniqueTags([...availableTags, normalizedQuery]));
    selectTag(normalizedQuery);
  }

  function removeTag(tagToRemove: SubjectTag) {
    onSelectedTagsChange(selectedTags.filter((tag) => tag !== tagToRemove));
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (isOpen) {
        event.preventDefault();
        event.stopPropagation();
        setIsOpen(false);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      if (suggestions.length > 0) {
        selectTag(suggestions[0]);
      } else if (canCreate) {
        createTag();
      }
      return;
    }

    if (event.key === "Backspace" && query.length === 0 && selectedTags.length > 0) {
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-muted bg-surface-app px-2.5 py-2 focus-within:border-primary"
        onClick={() => {
          openDropdown();
          inputRef.current?.focus();
        }}
      >
        {selectedTags.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1">
            <TagPill label={tag} />
            <button
              type="button"
              aria-label={`Remover tag ${tag}`}
              title={`Remover tag ${tag}`}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-subtle transition hover:bg-surface-muted hover:text-text-primary"
              onClick={(event) => {
                event.stopPropagation();
                removeTag(tag);
              }}
            >
              <RemoveIcon />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIsOpen(true);
          }}
          onFocus={openDropdown}
          onKeyDown={handleInputKeyDown}
          placeholder={selectedTags.length === 0 ? placeholder : ""}
          className="min-w-24 flex-1 border-0 bg-transparent px-1 py-0.5 text-sm text-text-primary outline-none placeholder:text-text-subtle"
        />
      </div>

      {isOpen ? (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border-muted bg-surface-panel py-1 shadow-lg">
          {suggestions.length === 0 && !canCreate ? (
            <p className="px-3 py-2 text-sm text-text-subtle">
              {availableTags.length === 0 ? "Nenhuma tag ainda. Digite para criar." : "Nenhuma tag encontrada."}
            </p>
          ) : null}

          {suggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              className="flex w-full items-center px-3 py-1.5 text-left transition hover:bg-surface-muted"
              onClick={() => selectTag(tag)}
            >
              <TagPill label={tag} />
            </button>
          ))}

          {canCreate ? (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-semibold text-text-primary transition hover:bg-surface-muted"
              onClick={createTag}
            >
              <span className="text-text-subtle">Criar</span>
              <TagPill label={normalizedQuery} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
