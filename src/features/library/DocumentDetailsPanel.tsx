import { useState } from "react";
import { IconButton } from "../../components/IconButton";
import { TagBadge } from "../../components/TagBadge";
import type { LibraryCollection, LibraryDocument, SubjectTag } from "../../types/library";
import { invoke } from "@tauri-apps/api/core";
import { TagSelector } from "./TagSelector";

type DocumentDetailsPanelProps = {
  document: LibraryDocument;
  collections: LibraryCollection[];
  availableTags: SubjectTag[];
  mode?: "library" | "trash";
  onClose: () => void;
  onOpenReader: (document: LibraryDocument) => void;
  onUpdateDocument: (documentId: string, updates: DocumentMetadataUpdates) => void;
  onToggleFavorite: (documentId: string) => void;
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
  onRestore?: (documentId: string) => void;
  onPermanentDelete?: (documentId: string) => void;
};

type DocumentMetadataUpdates = Pick<LibraryDocument, "title" | "authors" | "source" | "year" | "collection" | "tags">;

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function BookOpenIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 7v14" />
      <path d="M4 5a7 7 0 0 1 8 2 7 7 0 0 1 8-2v14a7 7 0 0 0-8 2 7 7 0 0 0-8-2z" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7v6h6" />
      <path d="M21 17a8 8 0 0 0-13.7-5.7L3 15" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function CollectionIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M3 7h5l2 2h11v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M3 7V5a1 1 0 0 1 1-1h4l2 3" />
    </svg>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20s-7-4.6-7-9.4A3.6 3.6 0 0 1 12 8a3.6 3.6 0 0 1 7 2.6C19 15.4 12 20 12 20z" />
    </svg>
  );
}

function PdfPreview({ year }: { year: number }) {
  return (
    <div className="rounded-lg border border-border-muted bg-surface-muted p-4">
      <div className="rounded-md border border-indigo-200 bg-surface-panel px-5 py-4 shadow-card">
        <div className="mx-auto h-2 w-36 rounded-full bg-primary" />
        <div className="mx-auto mt-2 h-1.5 w-44 rounded-full bg-indigo-200" />
        <div className="mx-auto mt-2 h-1.5 w-32 rounded-full bg-indigo-200" />
        <div className="mt-5 rounded border border-indigo-200 bg-primary-soft p-3">
          <div className="h-1.5 w-24 rounded-full bg-indigo-300" />
          <div className="mt-2 space-y-1.5">
            <div className="h-1 w-full rounded-full bg-indigo-200" />
            <div className="h-1 w-11/12 rounded-full bg-indigo-200" />
            <div className="h-1 w-10/12 rounded-full bg-indigo-200" />
            <div className="h-1 w-8/12 rounded-full bg-indigo-200" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <div className="h-1 w-full rounded-full bg-indigo-200" />
            <div className="h-1 w-10/12 rounded-full bg-indigo-200" />
            <div className="h-1 w-11/12 rounded-full bg-indigo-200" />
            <div className="h-1 w-8/12 rounded-full bg-indigo-200" />
          </div>
          <div className="space-y-1.5">
            <div className="h-1 w-full rounded-full bg-indigo-200" />
            <div className="h-1 w-9/12 rounded-full bg-indigo-200" />
            <div className="h-1 w-11/12 rounded-full bg-indigo-200" />
            <div className="h-1 w-7/12 rounded-full bg-indigo-200" />
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-sm text-text-secondary">15 paginas - {year}</p>
    </div>
  );
}

function formatAuthors(authors: string[]) {
  return authors.length > 6 ? `${authors.slice(0, 6).join(", ")} et al.` : authors.join(", ");
}

function formatAddedAt(updatedAt: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(updatedAt));
}

function splitAuthors(authors: string) {
  return authors
    .split(",")
    .map((author) => author.trim())
    .filter((author) => author.length > 0);
}

function EditDocumentModal({
  collections,
  availableTags,
  document,
  onClose,
  onSave,
  onAvailableTagsChange,
}: {
  collections: LibraryCollection[];
  availableTags: SubjectTag[];
  document: LibraryDocument;
  onClose: () => void;
  onSave: (updates: DocumentMetadataUpdates) => void;
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [authors, setAuthors] = useState(document.authors.join(", "));
  const [source, setSource] = useState(document.source);
  const [year, setYear] = useState(document.year.toString());
  const [collection, setCollection] = useState(document.collection);
  const [tags, setTags] = useState<SubjectTag[]>(document.tags);
  const [validationMessage, setValidationMessage] = useState("");

  function toggleTag(tag: SubjectTag) {
    setTags((currentTags) => (currentTags.includes(tag) ? currentTags.filter((currentTag) => currentTag !== tag) : [...currentTags, tag]));
  }

  function handleSave() {
    const nextAuthors = splitAuthors(authors);
    const nextYear = Number(year);

    if (title.trim().length === 0) {
      setValidationMessage("Informe um titulo.");
      return;
    }

    if (nextAuthors.length === 0) {
      setValidationMessage("Informe ao menos um autor.");
      return;
    }

    if (source.trim().length === 0) {
      setValidationMessage("Informe a fonte.");
      return;
    }

    if (!Number.isInteger(nextYear) || nextYear < 1000 || nextYear > 9999) {
      setValidationMessage("Informe um ano valido com quatro digitos.");
      return;
    }

    if (tags.length === 0) {
      setValidationMessage("Você deve ter pelo menos uma tag");
      return;
    }

    onSave({
      title: title.trim(),
      authors: nextAuthors,
      source: source.trim(),
      year: nextYear,
      collection,
      tags,
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={onClose}>
      <section className="w-full max-w-xl rounded-2xl bg-surface-panel shadow-2xl" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-border-subtle px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-text-primary">Editar PDF</h2>
            <p className="text-sm text-text-secondary">Atualize as informacoes do documento</p>
          </div>
          <button type="button" aria-label="Fechar edicao" className="rounded-md p-2 text-text-subtle hover:bg-surface-muted" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="grid max-h-[calc(100vh-210px)] gap-4 overflow-y-auto px-6 py-5">
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-text-primary">Titulo</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} className="rounded-lg border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-text-primary">Autores</span>
            <input value={authors} onChange={(event) => setAuthors(event.target.value)} className="rounded-lg border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary" />
          </label>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-text-primary">Fonte</span>
              <input value={source} onChange={(event) => setSource(event.target.value)} className="rounded-lg border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-text-primary">Ano</span>
              <input value={year} inputMode="numeric" onChange={(event) => setYear(event.target.value)} className="rounded-lg border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
          </div>

          <label className="grid gap-1.5">
            <span className="text-sm font-semibold text-text-primary">Colecao</span>
            <select value={collection} onChange={(event) => setCollection(event.target.value)} className="rounded-lg border border-border-muted px-3 py-2 text-sm outline-none focus:border-primary">
              {collections.map((availableCollection) => (
                <option key={availableCollection.id} value={availableCollection.name}>
                  {availableCollection.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="grid gap-2">
            <legend className="text-sm font-semibold text-text-primary">Tags</legend>
            <TagSelector
              availableTags={availableTags}
              selectedTags={tags}
              onAvailableTagsChange={onAvailableTagsChange}
              onSelectedTagsChange={setTags}
            />
          </fieldset>

          {validationMessage ? <div className="rounded-lg bg-status-red px-4 py-3 text-sm font-semibold text-status-red-text">{validationMessage}</div> : null}
        </div>

        <footer className="flex justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-muted" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button hover:bg-primary-hover" onClick={handleSave}>
            Salvar alteracoes
          </button>
        </footer>
      </section>
    </div>
  );
}

export function DocumentDetailsPanel({
  document,
  collections,
  availableTags,
  mode = "library",
  onClose,
  onOpenReader,
  onUpdateDocument,
  onToggleFavorite,
  onAvailableTagsChange,
  onRestore,
  onPermanentDelete,
}: DocumentDetailsPanelProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const isTrashMode = mode === "trash";

  async function openFileLocation() {
    if (!document.filePath) {
      return;
    }

    try {
      await invoke("open_file_location", { filePath: document.filePath });
    } catch (error) {
      console.error("Nao foi possivel abrir a pasta do PDF.", error);
    }
  }

  return (
    <aside className="min-h-0 w-full shrink-0 border-t border-border-subtle bg-surface-panel xl:w-[432px] xl:border-l xl:border-t-0">
      <header className="flex items-center gap-2 border-b border-border-subtle px-6 py-4 text-sm text-text-subtle">
        <span className="font-semibold">Detalhes</span>
        <span aria-hidden="true">&gt;</span>
        <span className="min-w-0 truncate text-text-secondary">{document.collection}</span>
        <button type="button" aria-label="Fechar detalhes" className="ml-auto rounded-md p-2 hover:bg-surface-muted" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="max-h-[42rem] overflow-y-auto px-6 py-6 xl:max-h-none xl:h-[calc(100vh-145px)]">
        <PdfPreview year={document.year} />

        <section className="mt-6">
          <h2 className="text-lg font-bold tracking-normal text-text-primary">{document.title}</h2>
          <p className="mt-2 text-sm leading-6 text-text-secondary">{formatAuthors(document.authors)}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {document.tags.map((tag) => (
              <TagBadge key={tag} tag={tag} />
            ))}
          </div>
        </section>

        {isTrashMode ? (
          <div className="mt-5 grid gap-2">
            <button
              type="button"
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
              onClick={() => onRestore?.(document.id)}
            >
              <RestoreIcon />
              <span>Restaurar</span>
            </button>
            <button
              type="button"
              className="inline-flex min-w-0 items-center justify-center gap-2 rounded-lg bg-status-red px-4 py-3 text-sm font-bold text-status-red-text transition hover:brightness-95"
              onClick={() => onPermanentDelete?.(document.id)}
            >
              <TrashIcon />
              <span>Excluir permanentemente</span>
            </button>
          </div>
        ) : (
          <>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="inline-flex min-w-0 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
                onClick={() => onOpenReader(document)}
              >
                <BookOpenIcon />
                <span>Abrir leitor</span>
              </button>
              <IconButton label="Editar detalhes" onClick={() => setIsEditModalOpen(true)}>
                <EditIcon />
              </IconButton>
              <IconButton label={document.filePath ? "Abrir pasta do PDF" : "Caminho local indisponivel"} disabled={!document.filePath} onClick={openFileLocation}>
                <CollectionIcon />
              </IconButton>
              <IconButton
                label={document.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                variant={document.favorite ? "accent" : "ghost"}
                onClick={() => onToggleFavorite(document.id)}
              >
                <HeartIcon filled={document.favorite} />
              </IconButton>
            </div>

            <section className="mt-5 rounded-lg border border-border-subtle bg-surface-card px-4 py-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-text-secondary">Progresso de leitura</span>
                <span className="font-bold text-primary">{document.progress}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, document.progress))}%` }} />
              </div>
            </section>
          </>
        )}

        <dl className="mt-5 divide-y divide-border-subtle rounded-lg border border-border-subtle bg-surface-card px-4 text-sm">
          <div className="py-4">
            <dt className="text-text-secondary">Fonte</dt>
            <dd className="mt-2 font-semibold text-text-primary">
              {document.source} {document.year}
            </dd>
          </div>
          <div className="py-4">
            <dt className="text-text-secondary">Ano</dt>
            <dd className="mt-2 font-semibold text-text-primary">{document.year}</dd>
          </div>
          <div className="py-4">
            <dt className="text-text-secondary">Adicionado em</dt>
            <dd className="mt-2 font-semibold text-text-primary">{formatAddedAt(document.updatedAt)}</dd>
          </div>
          <div className="py-4">
            <dt className="text-text-secondary">Colecao</dt>
            <dd className="mt-2 font-semibold text-text-primary">{document.collection}</dd>
          </div>
          <div className="py-4">
            <dt className="text-text-secondary">Arquivo</dt>
            <dd className="mt-2 break-words font-semibold text-text-primary">{document.filePath ?? document.fileName ?? "PDF local nao vinculado"}</dd>
          </div>
        </dl>
      </div>

      {isEditModalOpen ? (
        <EditDocumentModal
          collections={collections}
          availableTags={availableTags}
          document={document}
          onClose={() => setIsEditModalOpen(false)}
          onAvailableTagsChange={onAvailableTagsChange}
          onSave={(updates) => {
            onUpdateDocument(document.id, updates);
            setIsEditModalOpen(false);
          }}
        />
      ) : null}
    </aside>
  );
}
