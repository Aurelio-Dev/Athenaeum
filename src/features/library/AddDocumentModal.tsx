import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TagInput } from "../../components/ui/TagInput";
import { extractPdfMetadata } from "../../lib/pdfMetadata";
import type { LibraryCollection, LibraryDocument, SubjectTag } from "../../types/library";

// Colecao usada quando o usuario nao escolhe nenhuma. O import (import_document)
// cria a colecao por INSERT OR IGNORE, entao "Sem titulo" nasce se ainda nao
// existir — mesmo nome da colecao padrao semeada no banco.
const DEFAULT_COLLECTION_NAME = "Sem título";

type PickedPdfFile = {
  file_name: string;
  file_path: string;
};

type ImportStatus = "idle" | "importing" | "done" | "error";

type DraftItem = {
  key: string;
  fileName: string;
  filePath: string;
  title: string;
  authors: string;
  source: string;
  year: string;
  collection: string;
  tags: SubjectTag[];
  notes: string;
  extractionState: "loading" | "ready";
  status: ImportStatus;
  error?: string;
  overrideDuplicate: boolean;
};

type AddDocumentModalProps = {
  collections: LibraryCollection[];
  availableTags: SubjectTag[];
  existingDocuments: LibraryDocument[];
  // Colecao pre-selecionada ao abrir (ex.: ao adicionar de dentro de uma
  // colecao). Ausente => nenhuma selecao inicial.
  defaultCollectionId?: string;
  onClose: () => void;
  onAddDocument: (document: LibraryDocument) => void | Promise<void>;
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
};

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M14 3v5h5" />
      <path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? "rotate-90" : ""}`}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="animate-spin" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.2-8.6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  );
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

function fallbackTitle(fileName: string) {
  const cleanName = fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
  return cleanName.length > 0 ? cleanName : "Documento sem título";
}

function splitAuthors(authors: string) {
  return authors
    .split(/[;,]/)
    .map((author) => author.trim())
    .filter((author) => author.length > 0);
}

function createDocumentId(fileName: string) {
  const slug = fileName
    .replace(/\.pdf$/i, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${slug || "pdf"}-${crypto.randomUUID()}`;
}

function isPdfFileName(fileName: string) {
  return fileName.toLocaleLowerCase("pt-BR").endsWith(".pdf");
}

function getDroppedPath(file: File) {
  return (file as File & { path?: string }).path;
}

function authorsKey(authors: string[]) {
  return authors
    .map((author) => author.trim().toLocaleLowerCase("pt-BR"))
    .filter((author) => author.length > 0)
    .sort()
    .join("|");
}

function createDraftItem(picked: PickedPdfFile, collection = ""): DraftItem {
  return {
    key: crypto.randomUUID(),
    fileName: picked.file_name,
    filePath: picked.file_path,
    title: "",
    authors: "",
    source: "",
    year: "",
    collection,
    tags: [],
    notes: "",
    extractionState: "loading",
    status: "idle",
    overrideDuplicate: false,
  };
}

const inputClassName =
  "w-full min-w-0 rounded-lg border border-border-muted bg-surface-app px-3 py-2 text-sm text-text-primary outline-none focus:border-primary";
const labelClassName = "text-xs font-bold uppercase tracking-wide text-text-secondary";

export function AddDocumentModal({
  collections,
  availableTags,
  existingDocuments,
  defaultCollectionId,
  onClose,
  onAddDocument,
  onAvailableTagsChange,
}: AddDocumentModalProps) {
  // O seletor de colecao do modal e por NOME; convertemos o id recebido para o
  // nome correspondente. Vazio quando nao ha default (ou id inexistente).
  const defaultCollectionName = collections.find((collection) => collection.id === defaultCollectionId)?.name ?? "";

  const [items, setItems] = useState<DraftItem[]>([]);
  const [phase, setPhase] = useState<"review" | "importing">("review");
  const [batchCollection, setBatchCollection] = useState(defaultCollectionName);
  const [batchTags, setBatchTags] = useState<SubjectTag[]>([]);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const modalRef = useRef<HTMLElement | null>(null);
  const extractionStartedRef = useRef<Set<string>>(new Set());

  const isBatch = items.length > 1;
  const isImporting = items.some((item) => item.status === "importing");

  // Dispara a extracao de metadados de cada item novo exatamente uma vez.
  useEffect(() => {
    items.forEach((item) => {
      if (item.extractionState !== "loading" || extractionStartedRef.current.has(item.key)) {
        return;
      }

      extractionStartedRef.current.add(item.key);

      void extractPdfMetadata(item.filePath).then((metadata) => {
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.key === item.key
              ? {
                  ...currentItem,
                  title: currentItem.title || metadata.title || fallbackTitle(currentItem.fileName),
                  authors: currentItem.authors || metadata.authors,
                  year: currentItem.year || metadata.year || String(new Date().getFullYear()),
                  extractionState: "ready",
                }
              : currentItem,
          ),
        );
      });
    });
  }, [items]);

  function updateItem(key: string, updates: Partial<DraftItem>) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, ...updates } : item)));
  }

  function addFiles(picked: PickedPdfFile[]) {
    setItems((current) => {
      const existingPaths = new Set(current.map((item) => item.filePath));
      const additions = picked
        .filter((file) => isPdfFileName(file.file_name) && !existingPaths.has(file.file_path))
        .map((file) => createDraftItem(file, defaultCollectionName));

      return additions.length === 0 ? current : [...current, ...additions];
    });
  }

  async function openPicker() {
    try {
      const picked = await invoke<PickedPdfFile[]>("select_pdf_files");
      addFiles(picked);
    } catch (error) {
      console.error("Nao foi possivel abrir o seletor de arquivos.", error);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const dropped = Array.from(event.dataTransfer.files)
      .map((file) => ({ file_name: file.name, file_path: getDroppedPath(file) }))
      .filter((file): file is PickedPdfFile => Boolean(file.file_path));

    if (dropped.length > 0) {
      addFiles(dropped);
    }
  }

  function buildDocument(item: DraftItem): LibraryDocument {
    const collectionName = item.collection.trim() || (isBatch ? batchCollection.trim() : "") || DEFAULT_COLLECTION_NAME;
    const effectiveTags = item.tags.length > 0 ? item.tags : isBatch ? batchTags : [];
    const normalizedTags = [...new Set(effectiveTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
    const parsedYear = Number(item.year);
    const year = Number.isInteger(parsedYear) && parsedYear >= 1000 && parsedYear <= 9999 ? parsedYear : new Date().getFullYear();

    return {
      id: createDocumentId(item.fileName),
      title: item.title.trim(),
      authors: splitAuthors(item.authors),
      source: item.source.trim(),
      year,
      tags: normalizedTags,
      status: "not-started",
      progress: 0,
      favorite: false,
      collection: collectionName,
      updatedAt: new Date().toISOString(),
      fileName: item.fileName,
      filePath: item.filePath,
      notes: item.notes,
      timeSpentSeconds: 0,
    };
  }

  async function importItem(item: DraftItem) {
    updateItem(item.key, { status: "importing", error: undefined });

    try {
      await onAddDocument(buildDocument(item));
      updateItem(item.key, { status: "done" });
    } catch (error) {
      updateItem(item.key, { status: "error", error: getErrorMessage(error) });
    }
  }

  async function handleImport() {
    if (phase === "importing" || !canConfirm) {
      return;
    }

    setPhase("importing");
    setExpandedKey(null);

    for (const item of items) {
      await importItem(item);
    }
  }

  function removeItem(key: string) {
    extractionStartedRef.current.delete(key);
    setItems((current) => current.filter((item) => item.key !== key));

    if (expandedKey === key) {
      setExpandedKey(null);
    }
  }

  function isDuplicate(item: DraftItem) {
    const title = item.title.trim().toLocaleLowerCase("pt-BR");

    if (title.length === 0) {
      return false;
    }

    const itemAuthors = authorsKey(splitAuthors(item.authors));

    return existingDocuments.some(
      (document) => document.title.trim().toLocaleLowerCase("pt-BR") === title && authorsKey(document.authors) === itemAuthors,
    );
  }

  const canConfirm =
    items.length > 0 &&
    items.every((item) => item.extractionState === "ready") &&
    items.every((item) => item.title.trim().length > 0);
  const allResolved = items.length > 0 && items.every((item) => item.status === "done");

  function requestClose() {
    if (!isImporting) {
      onClose();
    }
  }

  function renderCollectionSelect(value: string, onChange: (value: string) => void) {
    return (
      <select value={value} onChange={(event) => onChange(event.target.value)} className={`${inputClassName} cursor-pointer`}>
        <option value="">Selecionar coleção...</option>
        {collections.map((collection) => (
          <option key={collection.id} value={collection.name}>
            {collection.name}
          </option>
        ))}
      </select>
    );
  }

  function renderDuplicateBanner(item: DraftItem) {
    if (!isDuplicate(item) || item.overrideDuplicate) {
      return null;
    }

    return (
      <div className="flex items-center gap-3 rounded-lg border border-highlight-amber-text bg-highlight-amber px-3 py-2.5 text-sm text-highlight-amber-text">
        <AlertIcon />
        <span className="min-w-0 flex-1">Já existe um documento parecido na sua biblioteca.</span>
        <button
          type="button"
          className="shrink-0 rounded-md border border-highlight-amber-text bg-surface-panel px-2.5 py-1 text-xs font-bold transition hover:brightness-95"
          onClick={() => updateItem(item.key, { overrideDuplicate: true })}
        >
          Importar mesmo assim
        </button>
      </div>
    );
  }

  function renderStatus(item: DraftItem) {
    if (item.status === "importing") {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-secondary">
          <SpinnerIcon />
          Importando...
        </span>
      );
    }

    if (item.status === "done") {
      return (
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-status-green-text">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-status-green text-status-green-text">
            <CheckIcon />
          </span>
          Concluído
        </span>
      );
    }

    if (item.status === "error") {
      return (
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-status-red-text">
          <AlertIcon />
          Falha ao importar
          <button type="button" className="rounded-md bg-surface-muted px-2 py-1 text-xs font-bold text-text-primary transition hover:brightness-95" onClick={() => void importItem(item)}>
            Tentar de novo
          </button>
          <button
            type="button"
            aria-label="Remover da lista"
            title="Remover da lista"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-subtle transition hover:bg-surface-muted hover:text-text-primary"
            onClick={() => removeItem(item.key)}
          >
            <CloseIcon />
          </button>
        </span>
      );
    }

    return null;
  }

  // Formulario completo de um item (usado no estado 2A e no item expandido do 2B).
  function renderDetailFields(item: DraftItem, individual: boolean) {
    if (item.extractionState === "loading") {
      return (
        <div className="space-y-2">
          <div className="h-9 animate-pulse rounded-lg bg-surface-muted" />
          <div className="h-9 animate-pulse rounded-lg bg-surface-muted" />
        </div>
      );
    }

    return (
      <div className="grid gap-4">
        <label className="grid gap-1.5">
          <span className={labelClassName}>Título</span>
          <input value={item.title} onChange={(event) => updateItem(item.key, { title: event.target.value })} className={inputClassName} placeholder="Título do documento" />
        </label>

        <label className="grid gap-1.5">
          <span className={labelClassName}>Autor(es)</span>
          <input value={item.authors} onChange={(event) => updateItem(item.key, { authors: event.target.value })} className={inputClassName} placeholder="Separe autores por vírgula" />
        </label>

        <div className="grid grid-cols-[120px_1fr] gap-3">
          <label className="grid min-w-0 gap-1.5">
            <span className={labelClassName}>Ano</span>
            <input value={item.year} inputMode="numeric" onChange={(event) => updateItem(item.key, { year: event.target.value })} className={inputClassName} placeholder="2026" />
          </label>

          <label className="grid min-w-0 gap-1.5">
            <span className={labelClassName}>Fonte</span>
            <input value={item.source} onChange={(event) => updateItem(item.key, { source: event.target.value })} className={inputClassName} placeholder="Conferência, periódico ou editora" />
          </label>
        </div>

        <div className="grid gap-1.5">
          <span className={labelClassName}>{individual ? "Coleção (individual)" : "Coleção"}</span>
          {renderCollectionSelect(item.collection, (value) => updateItem(item.key, { collection: value }))}
        </div>

        <div className="grid gap-1.5">
          <span className={labelClassName}>{individual ? "Tags (individuais)" : "Tags"}</span>
          <TagInput
            availableTags={availableTags}
            selectedTags={item.tags}
            onSelectedTagsChange={(tags) => updateItem(item.key, { tags })}
            onAvailableTagsChange={onAvailableTagsChange}
            boundaryRef={modalRef}
          />
        </div>

        {individual ? (
          <label className="grid gap-1.5">
            <span className={labelClassName}>Notas (opcional)</span>
            <textarea value={item.notes} onChange={(event) => updateItem(item.key, { notes: event.target.value })} rows={3} className={`${inputClassName} resize-none`} placeholder="Anotações sobre o documento" />
          </label>
        ) : null}
      </div>
    );
  }

  const headerTitle = items.length === 0 ? "Adicionar documentos" : isBatch ? `Revisão em lote — ${items.length} arquivos` : "Revise os detalhes";

  let footer: ReactNode = null;

  if (items.length > 0) {
    if (phase === "importing") {
      footer = (
        <button
          type="button"
          disabled={isImporting}
          onClick={onClose}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle disabled:shadow-none"
        >
          {isImporting ? "Importando..." : allResolved ? "Concluído — Fechar" : "Fechar"}
        </button>
      );
    } else {
      footer = (
        <button
          type="button"
          disabled={!canConfirm}
          onClick={() => void handleImport()}
          className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle disabled:shadow-none"
        >
          {isBatch ? `Adicionar ${items.length} arquivos à biblioteca →` : "Adicionar à biblioteca →"}
        </button>
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={requestClose}>
      <section
        ref={modalRef}
        className="flex max-h-[calc(100vh-48px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-panel shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={headerTitle}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start gap-3 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-text-primary">{headerTitle}</h2>
            {items.length > 0 ? (
              <button
                type="button"
                disabled={isImporting}
                onClick={() => void openPicker()}
                className="mt-1 text-sm font-semibold text-text-secondary transition hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-60"
              >
                ← Adicionar outro arquivo
              </button>
            ) : null}
          </div>
          <button
            type="button"
            aria-label="Fechar modal"
            disabled={isImporting}
            className="rounded-md p-2 text-text-subtle transition hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-40"
            onClick={requestClose}
          >
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {items.length === 0 ? (
            <div
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition ${
                isDragging ? "border-primary bg-primary-soft" : "border-border-strong hover:border-primary"
              }`}
              onClick={() => void openPicker()}
              onDrop={handleDrop}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
            >
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-surface-muted text-text-secondary">
                <UploadIcon />
              </div>
              <p className="text-base font-bold text-text-primary">Arraste PDFs aqui</p>
              <p className="mt-1 text-sm text-text-secondary">ou</p>
              <button
                type="button"
                className="mt-3 rounded-lg bg-surface-muted px-4 py-2 text-sm font-bold text-text-primary transition hover:brightness-95"
                onClick={(event) => {
                  event.stopPropagation();
                  void openPicker();
                }}
              >
                Escolher arquivo(s)
              </button>
              <p className="mt-4 text-xs text-text-subtle">PDF · máx. 100 MB por arquivo · seleção múltipla permitida</p>
            </div>
          ) : isBatch ? (
            <div className="grid gap-4">
              {phase === "review" ? (
                <div className="grid gap-3 rounded-xl bg-surface-app p-4">
                  <span className="text-xs font-bold uppercase tracking-wide text-text-subtle">Aplicar a todos os arquivos</span>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <span className={labelClassName}>Coleção</span>
                      {renderCollectionSelect(batchCollection, setBatchCollection)}
                    </div>
                    <div className="grid gap-1.5">
                      <span className={labelClassName}>Tags</span>
                      <TagInput
                        availableTags={availableTags}
                        selectedTags={batchTags}
                        onSelectedTagsChange={setBatchTags}
                        onAvailableTagsChange={onAvailableTagsChange}
                        boundaryRef={modalRef}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="divide-y divide-border-subtle">
                {items.map((item) => {
                  const isExpanded = expandedKey === item.key;

                  return (
                    <div key={item.key} className="py-3">
                      <div className="flex items-center gap-3">
                        <span className="text-text-subtle">
                          <FileIcon />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-text-primary">{item.title || fallbackTitle(item.fileName)}</p>
                        </div>
                        <span className="hidden min-w-0 max-w-[40%] truncate text-sm text-text-secondary sm:block">{item.authors}</span>
                        {phase === "importing" ? (
                          renderStatus(item)
                        ) : (
                          <>
                            {isDuplicate(item) && !item.overrideDuplicate ? <span className="text-highlight-amber-text"><AlertIcon /></span> : null}
                            <button
                              type="button"
                              aria-label={isExpanded ? "Recolher detalhes" : "Expandir detalhes"}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle transition hover:bg-surface-muted hover:text-text-primary"
                              onClick={() => setExpandedKey(isExpanded ? null : item.key)}
                            >
                              <ChevronIcon open={isExpanded} />
                            </button>
                          </>
                        )}
                      </div>

                      {phase === "review" && isExpanded ? (
                        <div className="mt-3 grid gap-3">
                          {renderDuplicateBanner(item)}
                          {renderDetailFields(item, true)}
                          <button type="button" className="justify-self-start text-sm font-semibold text-status-red-text transition hover:brightness-90" onClick={() => removeItem(item.key)}>
                            Remover da lista
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            // Estado 2A / 3 — arquivo unico.
            items.map((item) => (
              <div key={item.key} className="grid gap-4">
                <div className="flex items-center gap-3 rounded-lg bg-surface-app px-3 py-2.5">
                  <span className="text-text-subtle">
                    <FileIcon />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{item.fileName}</span>
                  {phase === "importing" ? renderStatus(item) : null}
                </div>

                {phase === "review" ? renderDuplicateBanner(item) : null}
                {renderDetailFields(item, false)}

                {phase === "review" ? (
                  <div>
                    <button type="button" className="flex items-center gap-1.5 text-sm font-semibold text-text-secondary transition hover:text-text-primary" onClick={() => setShowNotes((current) => !current)}>
                      <ChevronIcon open={showNotes} />
                      Notas (opcional)
                    </button>
                    {showNotes ? (
                      <textarea value={item.notes} onChange={(event) => updateItem(item.key, { notes: event.target.value })} rows={3} className={`${inputClassName} mt-2 resize-none`} placeholder="Anotações sobre o documento" />
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>

        {footer ? <footer className="shrink-0 px-6 pb-6 pt-2">{footer}</footer> : null}
      </section>
    </div>
  );
}
