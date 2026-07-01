import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import { TagBadge } from "../../components/TagBadge";
import type { LibraryCollection, LibraryDocument, SubjectTag } from "../../types/library";
import { DocumentPreview } from "./DocumentPreview";
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
  onUpdateNotes?: (documentId: string, notes: string) => void;
  onUpdateDocumentTags?: (documentId: string, tags: SubjectTag[]) => void;
  onRestore?: (documentId: string) => void;
  onPermanentDelete?: (documentId: string) => void;
};

// Tags saem daqui: agora sao gerenciadas inline no painel via onUpdateDocumentTags.
type DocumentMetadataUpdates = Pick<LibraryDocument, "title" | "authors" | "source" | "year" | "collection">;

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
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
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

function BookIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.59 13.41 12 22 2 12V4a2 2 0 0 1 2-2h8l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" x2="7.01" y1="7" y2="7" />
    </svg>
  );
}

function FileTextIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <line x1="8" x2="16" y1="13" y2="13" />
      <line x1="8" x2="16" y1="17" y2="17" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
    </svg>
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

const sectionLabelClassName = "text-xs font-semibold uppercase tracking-widest text-text-subtle";

function MetadataRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-text-subtle">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-subtle">{label}</p>
        <p className="break-words text-sm font-semibold text-text-primary">{value}</p>
      </div>
    </div>
  );
}

function EditDocumentModal({
  collections,
  document,
  onClose,
  onSave,
}: {
  collections: LibraryCollection[];
  document: LibraryDocument;
  onClose: () => void;
  onSave: (updates: DocumentMetadataUpdates) => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [authors, setAuthors] = useState(document.authors.join(", "));
  const [source, setSource] = useState(document.source);
  const [year, setYear] = useState(document.year.toString());
  const [collection, setCollection] = useState(document.collection);
  const [validationMessage, setValidationMessage] = useState("");

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

    onSave({
      title: title.trim(),
      authors: nextAuthors,
      source: source.trim(),
      year: nextYear,
      collection,
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
  onUpdateNotes,
  onUpdateDocumentTags,
  onRestore,
  onPermanentDelete,
}: DocumentDetailsPanelProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(document.notes ?? "");
  const initialNotesRef = useRef(document.notes ?? "");
  const tagDropdownRef = useRef<HTMLDivElement | null>(null);
  const isTrashMode = mode === "trash";

  // Reinicia o rascunho das notas ao trocar de documento (ou quando o valor
  // persistido muda). "Valor inicial do render" fica guardado no ref para o
  // onBlur so persistir se realmente mudou.
  useEffect(() => {
    setNotesDraft(document.notes ?? "");
    initialNotesRef.current = document.notes ?? "";
  }, [document.id, document.notes]);

  // Fecha o dropdown de tags ao clicar fora dele.
  useEffect(() => {
    if (!isTagDropdownOpen) {
      return;
    }

    function handlePointerDown(event: MouseEvent) {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(event.target as Node)) {
        setIsTagDropdownOpen(false);
      }
    }

    // window.document (nao a prop `document`, que e o LibraryDocument).
    window.document.addEventListener("mousedown", handlePointerDown);
    return () => window.document.removeEventListener("mousedown", handlePointerDown);
  }, [isTagDropdownOpen]);

  function handleNotesBlur() {
    if (notesDraft !== initialNotesRef.current) {
      onUpdateNotes?.(document.id, notesDraft);
      initialNotesRef.current = notesDraft;
    }
  }

  function removeTag(tag: SubjectTag) {
    onUpdateDocumentTags?.(
      document.id,
      document.tags.filter((currentTag) => currentTag !== tag),
    );
  }

  function handleTagSelectorChange(nextTags: SubjectTag[]) {
    onUpdateDocumentTags?.(document.id, nextTags);
    setIsTagDropdownOpen(false);
  }

  return (
    <aside className="min-h-0 w-full shrink-0 border-t border-border-subtle bg-surface-panel xl:w-[432px] xl:border-l xl:border-t-0">
      <header className="flex items-center border-b border-border-subtle px-6 py-4">
        <span className={sectionLabelClassName}>Detalhes</span>
        <button type="button" aria-label="Fechar detalhes" className="ml-auto rounded-md p-2 text-text-subtle hover:bg-surface-muted" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="max-h-[42rem] overflow-y-auto px-6 py-6 xl:max-h-none xl:h-[calc(100vh-145px)]">
        <DocumentPreview documentId={document.id} filePath={document.filePath} year={document.year} />

        <section className="mt-6">
          <h2 className="text-lg font-bold text-text-primary">{document.title}</h2>
          <p className="mt-1 text-sm text-primary">{formatAuthors(document.authors)}</p>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between border-b border-border-subtle pb-2">
            <span className={sectionLabelClassName}>Metadados</span>
            {isTrashMode ? null : (
              <IconButton label="Editar detalhes" onClick={() => setIsEditModalOpen(true)}>
                <EditIcon />
              </IconButton>
            )}
          </div>
          <div className="mt-3 grid gap-3">
            <MetadataRow icon={<BookIcon />} label="Fonte" value={document.source} />
            <MetadataRow icon={<CalendarIcon />} label="Ano" value={String(document.year)} />
            <MetadataRow icon={<ClockIcon />} label="Adicionado em" value={formatAddedAt(document.updatedAt)} />
            <MetadataRow icon={<CollectionIcon />} label="Coleção" value={document.collection} />
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center gap-2">
            <span className="text-text-subtle">
              <TagIcon />
            </span>
            <span className={sectionLabelClassName}>Tags</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {document.tags.map((tag) => (
              <span key={tag} className="group relative inline-flex">
                <TagBadge tag={tag} />
                {isTrashMode ? null : (
                  <button
                    type="button"
                    aria-label={`Remover tag ${tag}`}
                    title={`Remover tag ${tag}`}
                    className="absolute -right-1.5 -top-1.5 hidden h-[14px] w-[14px] items-center justify-center rounded-full bg-status-red text-[10px] font-bold leading-none text-status-red-text shadow-sm group-hover:flex"
                    onClick={() => removeTag(tag)}
                  >
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </span>
            ))}

            {isTrashMode ? null : (
              <div className="relative" ref={tagDropdownRef}>
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-secondary transition hover:bg-surface-muted"
                  onClick={() => setIsTagDropdownOpen((current) => !current)}
                >
                  + Tag
                </button>
                {isTagDropdownOpen ? (
                  <div className="absolute left-0 top-full z-10 mt-1 w-64 rounded-lg border border-border-muted bg-surface-panel p-3 shadow-lg">
                    <TagSelector
                      availableTags={availableTags}
                      selectedTags={document.tags}
                      onAvailableTagsChange={onAvailableTagsChange}
                      onSelectedTagsChange={handleTagSelectorChange}
                    />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center gap-2">
            <span className="text-text-subtle">
              <FileTextIcon />
            </span>
            <span className={sectionLabelClassName}>Notas</span>
          </div>
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            onBlur={handleNotesBlur}
            readOnly={isTrashMode}
            rows={4}
            placeholder="Adicione anotações sobre este documento..."
            className="mt-3 w-full resize-none rounded-lg border border-border-subtle bg-surface-card p-3 text-sm text-text-primary outline-none focus:border-primary placeholder:text-text-subtle"
          />
        </section>

        {isTrashMode ? null : (
          <section className="mt-6">
            <div className="flex items-center justify-between">
              <span className={sectionLabelClassName}>Progresso de leitura</span>
              <span className="text-sm font-bold text-primary">{document.progress}%</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
              <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, document.progress))}%` }} />
            </div>
          </section>
        )}

        {isTrashMode ? (
          <div className="mt-6 grid gap-2">
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
          <div className="mt-6 space-y-2">
            <div className="flex gap-2">
              <button
                type="button"
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold transition ${
                  document.favorite ? "bg-status-red text-status-red-text hover:brightness-95" : "bg-surface-muted text-text-secondary hover:brightness-95"
                }`}
                onClick={() => onToggleFavorite(document.id)}
              >
                <HeartIcon filled={document.favorite} />
                <span>Favorito</span>
              </button>
              <button
                type="button"
                disabled
                title="Em breve"
                className="inline-flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-lg bg-surface-muted px-4 py-3 text-sm font-bold text-text-secondary opacity-50"
              >
                <BookmarkIcon />
                <span>Leitura</span>
              </button>
            </div>
            <button
              type="button"
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover"
              onClick={() => onOpenReader(document)}
            >
              <BookOpenIcon />
              <span>Abrir no Leitor</span>
            </button>
          </div>
        )}
      </div>

      {isEditModalOpen ? (
        <EditDocumentModal
          collections={collections}
          document={document}
          onClose={() => setIsEditModalOpen(false)}
          onSave={(updates) => {
            onUpdateDocument(document.id, updates);
            setIsEditModalOpen(false);
          }}
        />
      ) : null}
    </aside>
  );
}

