import { useRef, useState } from "react";
import { TagBadge } from "../../components/TagBadge";
import type { SubjectTag } from "../../types/library";

type TagSelectorProps = {
  availableTags: SubjectTag[];
  selectedTags: SubjectTag[];
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
  onSelectedTagsChange: (tags: SubjectTag[]) => void;
};

function AddIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.16667" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1.75 3.5H12.25" />
      <path d="M11.0833 3.5V11.6667C11.0833 12.25 10.5 12.8333 9.91667 12.8333H4.08333C3.5 12.8333 2.91667 12.25 2.91667 11.6667V3.5" />
      <path d="M4.66667 3.5V2.33334C4.66667 1.75 5.25 1.16667 5.83333 1.16667H8.16667C8.75 1.16667 9.33333 1.75 9.33333 2.33334V3.5" />
      <path d="M5.83333 6.41667V9.91667" />
      <path d="M8.16667 6.41667V9.91667" />
    </svg>
  );
}

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

export function TagSelector({ availableTags, selectedTags, onAvailableTagsChange, onSelectedTagsChange }: TagSelectorProps) {
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isRemoveMode, setIsRemoveMode] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [editingTag, setEditingTag] = useState<SubjectTag | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const editingInputRef = useRef<HTMLInputElement | null>(null);

  function toggleTag(tag: SubjectTag) {
    onSelectedTagsChange(selectedTags.includes(tag) ? selectedTags.filter((selectedTag) => selectedTag !== tag) : [...selectedTags, tag]);
  }

  function startAddingTag() {
    setIsAddingTag(true);
    setIsRemoveMode(false);
    setEditingTag(null);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function cancelAddingTag() {
    setNewTagName("");
    setIsAddingTag(false);
  }

  function commitNewTag() {
    const normalizedTag = normalizeTag(newTagName);

    if (normalizedTag.length === 0) {
      cancelAddingTag();
      return;
    }

    const existingTag = availableTags.find((tag) => tag.toLocaleLowerCase("pt-BR") === normalizedTag.toLocaleLowerCase("pt-BR"));
    const tagToSelect = existingTag ?? normalizedTag;

    if (!existingTag) {
      onAvailableTagsChange(mergeUniqueTags([...availableTags, normalizedTag]));
    }

    if (!selectedTags.includes(tagToSelect)) {
      onSelectedTagsChange([...selectedTags, tagToSelect]);
    }

    setNewTagName("");
    setIsAddingTag(false);
  }

  function startRenamingTag(tag: SubjectTag) {
    if (isRemoveMode) {
      return;
    }

    setIsAddingTag(false);
    setEditingTag(tag);
    setEditingTagName(tag);
    window.requestAnimationFrame(() => editingInputRef.current?.select());
  }

  function cancelRenamingTag() {
    setEditingTag(null);
    setEditingTagName("");
  }

  function commitRenamedTag() {
    if (!editingTag) {
      return;
    }

    const normalizedTag = normalizeTag(editingTagName);

    if (normalizedTag.length === 0) {
      return;
    }

    const existingTag = availableTags.find(
      (tag) => tag !== editingTag && tag.toLocaleLowerCase("pt-BR") === normalizedTag.toLocaleLowerCase("pt-BR"),
    );
    const nextTagName = existingTag ?? normalizedTag;
    const nextAvailableTags = availableTags.map((tag) => (tag === editingTag ? nextTagName : tag)).filter((tag) => tag !== editingTag || tag === nextTagName);
    const nextSelectedTags = selectedTags.map((tag) => (tag === editingTag ? nextTagName : tag));

    onAvailableTagsChange(mergeUniqueTags(nextAvailableTags));
    onSelectedTagsChange(mergeUniqueTags(nextSelectedTags));
    setEditingTag(null);
    setEditingTagName("");
  }

  function removeTag(tagToRemove: SubjectTag) {
    onAvailableTagsChange(availableTags.filter((tag) => tag !== tagToRemove));
    onSelectedTagsChange(selectedTags.filter((tag) => tag !== tagToRemove));

    if (editingTag === tagToRemove) {
      cancelRenamingTag();
    }

  }

  function toggleRemoveMode() {
    setIsRemoveMode((currentMode) => !currentMode);
    setIsAddingTag(false);
    cancelRenamingTag();
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {availableTags.map((tag) => {
          const isSelected = selectedTags.includes(tag);
          const isEditing = editingTag === tag;

          return isEditing ? (
            <span key={tag} className="inline-flex min-w-0 items-center gap-1">
              <input
                ref={editingInputRef}
                value={editingTagName}
                onChange={(event) => setEditingTagName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitRenamedTag();
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRenamingTag();
                  }
                }}
                className="h-8 w-36 min-w-0 rounded-md border border-primary px-2 text-xs font-semibold text-text-primary outline-none focus:ring-2 focus:ring-primary-soft sm:w-44"
                placeholder="Renomear tag"
              />
              <button
                type="button"
                aria-label="Cancelar renomeacao"
                title="Cancelar renomeacao"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-status-red text-status-red-text transition hover:brightness-95"
                onClick={cancelRenamingTag}
              >
                <CloseIcon />
              </button>
            </span>
          ) : (
            <span key={tag} className="inline-flex items-center gap-1">
              <button
                type="button"
                className={`rounded-md border px-0 py-0 transition ${
                  isRemoveMode
                    ? "border-status-red-text bg-status-red text-status-red-text"
                    : isSelected
                      ? "border-primary ring-2 ring-primary-soft"
                      : "border-transparent opacity-75 hover:opacity-100"
                }`}
                title={isRemoveMode ? "Clique para remover esta tag" : "Clique para selecionar. Dois cliques para renomear."}
                onClick={() => {
                  if (isRemoveMode) {
                    removeTag(tag);
                    return;
                  }

                  toggleTag(tag);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  startRenamingTag(tag);
                }}
              >
                {isRemoveMode ? (
                  <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold text-status-red-text">{tag}</span>
                ) : (
                  <TagBadge tag={tag} />
                )}
              </button>
            </span>
          );
        })}

        {isAddingTag ? (
          <span className="inline-flex min-w-0 items-center gap-1">
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
                  event.preventDefault();
                  cancelAddingTag();
                }
              }}
            className="h-8 w-36 min-w-0 rounded-md border border-primary px-2 text-xs font-semibold text-text-primary outline-none focus:ring-2 focus:ring-primary-soft sm:w-44"
            placeholder="Nova tag"
          />
          <button
            type="button"
            aria-label="Confirmar nova tag"
            title="Confirmar nova tag"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-status-green text-status-green-text transition hover:brightness-95"
            onClick={commitNewTag}
          >
            <CheckIcon />
          </button>
          <button
            type="button"
            aria-label="Cancelar nova tag"
              title="Cancelar nova tag"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-status-red text-status-red-text transition hover:brightness-95"
              onClick={cancelAddingTag}
            >
              <CloseIcon />
            </button>
          </span>
        ) : (
          <>
            <button
              type="button"
              aria-label="Adicionar tag"
              title="Adicionar tag"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border-muted bg-surface-panel text-primary transition hover:border-primary hover:bg-primary-soft"
              onClick={startAddingTag}
            >
              <AddIcon />
            </button>
            <button
              type="button"
              aria-label={isRemoveMode ? "Sair do modo remover tags" : "Remover tags"}
              title={isRemoveMode ? "Sair do modo remover tags" : "Remover tags"}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md bg-status-red text-status-red-text transition hover:brightness-95 ${
                isRemoveMode ? "ring-2 ring-status-red-text" : ""
              }`}
              onClick={toggleRemoveMode}
            >
              <TrashIcon />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
