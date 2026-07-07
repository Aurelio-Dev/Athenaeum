import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { IconButton } from "../../components/IconButton";
import { TagBadge } from "../../components/TagBadge";
import { HeartIcon, TrashIcon } from "../../components/ui/SharedIcons";
import { getNextSubjectTagTone, registerSubjectTagTone, rememberSubjectTagToneAlias } from "../../styles/designTokens";
import type { LibraryCollection, LibraryDocument, SubjectTag, Tone } from "../../types/library";
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
  onUpdateTagTone?: (tag: SubjectTag, tone: Tone) => void;
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

function EditIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

function FolderMetadataIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path
        d="M3.24992 7.58339L4.06242 6.01255C4.15075 5.83713 4.28511 5.68902 4.45112 5.58407C4.61714 5.47911 4.80856 5.42127 5.00492 5.41672H10.8333M10.8333 5.41672C10.9987 5.41643 11.1621 5.45406 11.3108 5.52672C11.4595 5.59939 11.5896 5.70515 11.691 5.8359C11.7925 5.96664 11.8626 6.1189 11.8961 6.28098C11.9296 6.44305 11.9255 6.61064 11.8841 6.77089L11.0499 10.0209C10.9896 10.2546 10.8529 10.4616 10.6615 10.6088C10.4701 10.756 10.2351 10.835 9.99367 10.8334H2.16659C1.87927 10.8334 1.60372 10.7192 1.40055 10.5161C1.19739 10.3129 1.08325 10.0374 1.08325 9.75005V2.70839C1.08325 2.42107 1.19739 2.14552 1.40055 1.94235C1.60372 1.73919 1.87927 1.62505 2.16659 1.62505H4.27909C4.46027 1.62328 4.639 1.66697 4.79892 1.75214C4.95885 1.83731 5.09486 1.96122 5.1945 2.11255L5.63325 2.76255C5.73189 2.91234 5.86618 3.03529 6.02407 3.12038C6.18195 3.20547 6.35848 3.25002 6.53784 3.25005H9.74992C10.0372 3.25005 10.3128 3.36419 10.516 3.56735C10.7191 3.77052 10.8333 4.04607 10.8333 4.33339V5.41672Z"
        stroke="currentColor"
        strokeWidth="1.08333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DatabaseMetadataIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 4.33337C9.19239 4.33337 11.375 3.60584 11.375 2.70837C11.375 1.81091 9.19239 1.08337 6.5 1.08337C3.80761 1.08337 1.625 1.81091 1.625 2.70837C1.625 3.60584 3.80761 4.33337 6.5 4.33337Z" stroke="currentColor" strokeWidth="1.08333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.625 2.70837V10.2917C1.625 10.7227 2.13861 11.136 3.05285 11.4408C3.96709 11.7455 5.20707 11.9167 6.5 11.9167C7.79293 11.9167 9.03291 11.7455 9.94715 11.4408C10.8614 11.136 11.375 10.7227 11.375 10.2917V2.70837" stroke="currentColor" strokeWidth="1.08333" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.625 6.5C1.625 6.93098 2.13861 7.3443 3.05285 7.64905C3.96709 7.9538 5.20707 8.125 6.5 8.125C7.79293 8.125 9.03291 7.9538 9.94715 7.64905C10.8614 7.3443 11.375 6.93098 11.375 6.5" stroke="currentColor" strokeWidth="1.08333" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function OpenBookMetadataIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <path d="M6.5 3.79163V11.375" stroke="currentColor" strokeWidth="1.08333" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M1.62492 9.75C1.48126 9.75 1.34348 9.69293 1.2419 9.59135C1.14032 9.48977 1.08325 9.35199 1.08325 9.20833V2.16667C1.08325 2.02301 1.14032 1.88523 1.2419 1.78365C1.34348 1.68207 1.48126 1.625 1.62492 1.625H4.33325C4.90789 1.625 5.45899 1.85327 5.86532 2.2596C6.27165 2.66593 6.49992 3.21703 6.49992 3.79167C6.49992 3.21703 6.72819 2.66593 7.13452 2.2596C7.54085 1.85327 8.09195 1.625 8.66659 1.625H11.3749C11.5186 1.625 11.6564 1.68207 11.7579 1.78365C11.8595 1.88523 11.9166 2.02301 11.9166 2.16667V9.20833C11.9166 9.35199 11.8595 9.48977 11.7579 9.59135C11.6564 9.69293 11.5186 9.75 11.3749 9.75H8.12492C7.69394 9.75 7.28062 9.9212 6.97587 10.226C6.67112 10.5307 6.49992 10.944 6.49992 11.375C6.49992 10.944 6.32871 10.5307 6.02397 10.226C5.71922 9.9212 5.3059 9.75 4.87492 9.75H1.62492Z"
        stroke="currentColor"
        strokeWidth="1.08333"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function ReadingProgressIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="5" x2="11" y1="7" y2="7" />
      <line x1="5" x2="17" y1="12" y2="12" />
      <line x1="5" x2="21" y1="17" y2="17" />
    </svg>
  );
}

function formatAuthors(authors: string[]) {
  return authors.length > 6 ? `${authors.slice(0, 6).join(", ")} et al.` : authors.join(", ");
}

function formatAddedAt(updatedAt: string) {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(updatedAt));
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

function splitAuthors(authors: string) {
  return authors
    .split(",")
    .map((author) => author.trim())
    .filter((author) => author.length > 0);
}

const sectionLabelClassName = "text-xs font-semibold uppercase tracking-widest text-text-subtle";
const metadataInputClassName =
  "w-full min-w-0 rounded-lg border border-border-muted bg-surface-app px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-subtle focus:border-primary";
const metadataLabelClassName = "text-xs font-bold uppercase tracking-wide text-text-secondary";

function MetadataRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0 text-text-secondary">{icon}</span>
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">{label}</p>
        <p className="mt-1 break-words text-sm font-normal text-[#2C1810] dark:text-[#F0E8DF]">{value}</p>
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
      setValidationMessage("Informe um título.");
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
      setValidationMessage("Informe um ano válido com quatro dígitos.");
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
      <section
        className="flex max-h-[calc(100vh-48px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label="Revise os detalhes"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-text-primary">Revise os detalhes</h2>
            <p className="mt-1 text-sm text-text-secondary">Atualize os metadados do documento.</p>
          </div>
          <button type="button" aria-label="Fechar edição" className="rounded-md p-2 text-text-subtle transition hover:bg-surface-muted" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          <div className="grid gap-4">
            <label className="grid gap-1.5">
              <span className={metadataLabelClassName}>Título</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} className={metadataInputClassName} placeholder="Título do documento" />
            </label>

            <label className="grid gap-1.5">
              <span className={metadataLabelClassName}>Autor(es)</span>
              <input value={authors} onChange={(event) => setAuthors(event.target.value)} className={metadataInputClassName} placeholder="Separe autores por vírgula" />
            </label>

            <div className="grid grid-cols-[120px_1fr] gap-3">
              <label className="grid min-w-0 gap-1.5">
                <span className={metadataLabelClassName}>Ano</span>
                <input value={year} inputMode="numeric" onChange={(event) => setYear(event.target.value)} className={metadataInputClassName} placeholder="2026" />
              </label>
              <label className="grid min-w-0 gap-1.5">
                <span className={metadataLabelClassName}>Fonte</span>
                <input value={source} onChange={(event) => setSource(event.target.value)} className={metadataInputClassName} placeholder="Conferência, periódico ou editora" />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className={metadataLabelClassName}>Coleção</span>
              <select value={collection} onChange={(event) => setCollection(event.target.value)} className={`${metadataInputClassName} cursor-pointer`}>
                {collections.map((availableCollection) => (
                  <option key={availableCollection.id} value={availableCollection.name}>
                    {availableCollection.name}
                  </option>
                ))}
              </select>
            </label>

            {validationMessage ? <div className="rounded-lg bg-status-red px-4 py-3 text-sm font-semibold text-status-red-text">{validationMessage}</div> : null}
          </div>
        </div>

        <footer className="flex shrink-0 justify-end gap-3 px-6 pb-6 pt-2">
          <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-muted" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button hover:bg-primary-hover" onClick={handleSave}>
            Salvar alterações
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
  onUpdateTagTone,
  onRestore,
  onPermanentDelete,
}: DocumentDetailsPanelProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isTagDropdownOpen, setIsTagDropdownOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<SubjectTag | null>(null);
  const [editingTagName, setEditingTagName] = useState("");
  const [notesDraft, setNotesDraft] = useState(document.notes ?? "");
  const initialNotesRef = useRef(document.notes ?? "");
  const tagDropdownRef = useRef<HTMLDivElement | null>(null);
  const editingTagInputRef = useRef<HTMLInputElement | null>(null);
  const tagClickTimeoutRef = useRef<number | null>(null);
  const [, setTagColorRevision] = useState(0);
  const isTrashMode = mode === "trash";

  // Reinicia o rascunho das notas ao trocar de documento (ou quando o valor
  // persistido muda). "Valor inicial do render" fica guardado no ref para o
  // onBlur so persistir se realmente mudou.
  useEffect(() => {
    setNotesDraft(document.notes ?? "");
    initialNotesRef.current = document.notes ?? "";
    setEditingTag(null);
    setEditingTagName("");
  }, [document.id, document.notes]);

  useEffect(() => {
    return () => {
      if (tagClickTimeoutRef.current !== null) {
        window.clearTimeout(tagClickTimeoutRef.current);
      }
    };
  }, []);

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

  function startRenamingTag(tag: SubjectTag) {
    if (isTrashMode) {
      return;
    }

    if (tagClickTimeoutRef.current !== null) {
      window.clearTimeout(tagClickTimeoutRef.current);
      tagClickTimeoutRef.current = null;
    }

    setIsTagDropdownOpen(false);
    setEditingTag(tag);
    setEditingTagName(tag);
    window.requestAnimationFrame(() => editingTagInputRef.current?.select());
  }

  function cycleTagTone(tag: SubjectTag) {
    const nextTone = getNextSubjectTagTone(tag);
    registerSubjectTagTone(tag, nextTone);
    setTagColorRevision((revision) => revision + 1);
    onUpdateTagTone?.(tag, nextTone);
  }

  function handleTagClick(tag: SubjectTag) {
    if (isTrashMode) {
      return;
    }

    if (tagClickTimeoutRef.current !== null) {
      window.clearTimeout(tagClickTimeoutRef.current);
    }

    tagClickTimeoutRef.current = window.setTimeout(() => {
      tagClickTimeoutRef.current = null;
      cycleTagTone(tag);
    }, 220);
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
      cancelRenamingTag();
      return;
    }

    const existingTag = availableTags.find(
      (tag) => tag !== editingTag && tag.toLocaleLowerCase("pt-BR") === normalizedTag.toLocaleLowerCase("pt-BR"),
    );
    const nextTagName = existingTag ?? normalizedTag;
    const nextAvailableTags = availableTags.map((tag) => (tag === editingTag ? nextTagName : tag));
    const nextDocumentTags = document.tags.map((tag) => (tag === editingTag ? nextTagName : tag));

    if (!existingTag) {
      rememberSubjectTagToneAlias(editingTag, nextTagName);
    }
    onAvailableTagsChange(mergeUniqueTags(nextAvailableTags));
    onUpdateDocumentTags?.(document.id, mergeUniqueTags(nextDocumentTags));
    cancelRenamingTag();
  }

  function handleTagSelectorChange(nextTags: SubjectTag[]) {
    onUpdateDocumentTags?.(document.id, nextTags);
    setIsTagDropdownOpen(false);
  }

  return (
    <aside className="min-h-0 w-full shrink-0 flex flex-col border-t border-border-subtle bg-surface-panel font-sans xl:w-[432px] xl:border-l xl:border-t-0">
      <header className="flex items-center px-6 py-4">
        <span className={sectionLabelClassName}>Detalhes</span>
        <button type="button" aria-label="Fechar detalhes" className="ml-auto rounded-md p-2 text-text-subtle hover:bg-surface-muted" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <DocumentPreview documentId={document.id} filePath={document.filePath} year={document.year} />

        <section className="mt-6">
          <h2 className="font-sans text-lg font-bold text-[#2C1810] dark:text-[#F0E8DF]">{document.title}</h2>
          <p className="mt-2 text-sm font-normal text-text-secondary">{formatAuthors(document.authors)}</p>
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
            <MetadataRow icon={<DatabaseMetadataIcon />} label="Fonte" value={document.source} />
            <MetadataRow icon={<CalendarIcon />} label="Ano" value={String(document.year)} />
            <MetadataRow icon={<OpenBookMetadataIcon />} label="Adicionado em" value={formatAddedAt(document.updatedAt)} />
            <MetadataRow icon={<FolderMetadataIcon />} label="Coleção" value={document.collection} />
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center gap-2 border-b border-border-subtle pb-2">
            <span className="text-text-subtle">
              <TagIcon />
            </span>
            <span className={sectionLabelClassName}>Tags</span>
          </div>
          <div className="relative mt-3" ref={tagDropdownRef}>
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            {document.tags.map((tag) => (
              <span key={tag} className="group relative inline-flex min-w-0 max-w-full">
                {editingTag === tag ? (
                  <input
                    ref={editingTagInputRef}
                    value={editingTagName}
                    onChange={(event) => setEditingTagName(event.target.value)}
                    onBlur={commitRenamedTag}
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
                    className="h-7 min-w-0 max-w-full rounded-full border border-primary bg-surface-card px-2.5 text-xs font-semibold text-text-primary outline-none placeholder:text-text-subtle focus:ring-2 focus:ring-primary-soft"
                    placeholder="Renomear tag"
                  />
                ) : (
                  <button
                    type="button"
                    className="min-w-0 max-w-full rounded-full text-left"
                    title={isTrashMode ? undefined : "Clique para trocar a cor. Dois cliques para renomear"}
                    onClick={() => handleTagClick(tag)}
                    onDoubleClick={() => startRenamingTag(tag)}
                  >
                    <TagBadge tag={tag} />
                  </button>
                )}
                {isTrashMode || editingTag === tag ? null : (
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
                <button
                  type="button"
                  className="inline-flex items-center rounded-full border border-dashed border-[#D6C8BB] bg-[#E8DDD4] px-2.5 py-1 text-xs font-medium text-text-secondary transition hover:brightness-95 dark:border-[#4A3A2F] dark:bg-[#332820]"
                  onClick={() => setIsTagDropdownOpen((current) => !current)}
                >
                  + Tag
                </button>
              )}
            </div>

            {isTagDropdownOpen ? (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border-muted bg-surface-panel p-3 shadow-lg">
                <TagSelector
                  availableTags={availableTags}
                  selectedTags={document.tags}
                  onAvailableTagsChange={onAvailableTagsChange}
                  onSelectedTagsChange={handleTagSelectorChange}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center gap-2 border-b border-border-subtle pb-2">
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
            className="mt-3 w-full resize-none rounded-lg border border-border-subtle bg-surface-app p-3 text-sm text-text-primary outline-none focus:border-primary placeholder:text-text-subtle"
          />
        </section>

        {isTrashMode ? null : (
          <section className="mt-6">
            <div className="flex items-center justify-between border-b border-border-subtle pb-2">
              <span className="flex items-center gap-2">
                <span className="text-text-subtle">
                  <ReadingProgressIcon />
                </span>
                <span className={sectionLabelClassName}>Progresso de leitura</span>
              </span>
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
