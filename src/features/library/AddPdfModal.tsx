import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ExtractedPdfMetadata, LibraryCollection, LibraryDocument, SubjectTag } from "../../types/library";
import { TagSelector } from "./TagSelector";

type AddPdfModalProps = {
  collections: LibraryCollection[];
  availableTags: SubjectTag[];
  onClose: () => void;
  onAddDocument: (document: LibraryDocument) => void | Promise<void>;
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
};

type ExtractionState = "idle" | "loading" | "ready";

type SelectedPdfFile = {
  name: string;
  filePath?: string;
  fileUrl: string;
  originalFile?: File;
};

type NativePdfFile = {
  file_name: string;
  file_path: string;
  data_base64: string;
};

const emptyMetadata: ExtractedPdfMetadata = {
  title: "",
  authors: "",
  source: "",
  year: "",
};

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M14 3v5h5" />
      <path d="M7 3h7l5 5v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M5 16v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" />
    </svg>
  );
}

function buildExtractedMetadata(fileName: string): ExtractedPdfMetadata {
  const cleanName = fileName.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
  const title = cleanName.length > 0 ? cleanName.replace(/\b\w/g, (letter) => letter.toLocaleUpperCase("pt-BR")) : "Artigo importado";

  return {
    title,
    authors: "Autor não identificado",
    source: "PDF local",
    year: new Date().getFullYear().toString(),
  };
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || file.name.toLocaleLowerCase("pt-BR").endsWith(".pdf");
}

function splitAuthors(authors: string) {
  return authors
    .split(",")
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

function getLocalFilePath(file: File) {
  return (file as File & { path?: string }).path;
}

function base64ToBlobUrl(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
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

export function AddPdfModal({ collections, availableTags, onClose, onAddDocument, onAvailableTagsChange }: AddPdfModalProps) {
  const [selectedFile, setSelectedFile] = useState<SelectedPdfFile | null>(null);
  const [metadata, setMetadata] = useState<ExtractedPdfMetadata>(emptyMetadata);
  const [extractionState, setExtractionState] = useState<ExtractionState>("idle");
  const [selectedCollection, setSelectedCollection] = useState(collections[0]?.name ?? "");
  const [selectedTags, setSelectedTags] = useState<SubjectTag[]>([]);
  const [validationMessage, setValidationMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const extractionTimerRef = useRef<number | null>(null);

  function clearExtractionTimer() {
    if (extractionTimerRef.current !== null) {
      window.clearTimeout(extractionTimerRef.current);
      extractionTimerRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      clearExtractionTimer();
    };
  }, []);

  function beginMetadataExtraction(fileName: string) {
    clearExtractionTimer();

    setExtractionState("loading");
    setMetadata(emptyMetadata);
    extractionTimerRef.current = window.setTimeout(() => {
      setMetadata(buildExtractedMetadata(fileName));
      setExtractionState("ready");
      extractionTimerRef.current = null;
    }, 850);
  }

  function selectFile(file: File) {
    if (!isPdfFile(file)) {
      clearExtractionTimer();
      setValidationMessage("Selecione um arquivo PDF válido.");
      setSelectedFile(null);
      setExtractionState("idle");
      setMetadata(emptyMetadata);
      return;
    }

    setValidationMessage("");
    setSelectedFile({
      name: file.name,
      filePath: getLocalFilePath(file),
      fileUrl: URL.createObjectURL(file),
      originalFile: file,
    });
    beginMetadataExtraction(file.name);
  }

  async function selectNativeFile() {
    try {
      const nativeFile = await invoke<NativePdfFile | null>("select_pdf_file");

      if (!nativeFile) {
        return;
      }

      setValidationMessage("");
      setSelectedFile({
        name: nativeFile.file_name,
        filePath: nativeFile.file_path,
        fileUrl: base64ToBlobUrl(nativeFile.data_base64),
      });
      beginMetadataExtraction(nativeFile.file_name);
    } catch (error) {
      console.error("Nao foi possivel abrir o seletor nativo.", error);
      fileInputRef.current?.click();
    }
  }

  function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) {
      selectFile(file);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      selectFile(file);
    }
  }

  function updateMetadataField(field: keyof ExtractedPdfMetadata, value: string) {
    setMetadata((currentMetadata) => ({
      ...currentMetadata,
      [field]: value,
    }));
  }

  function validateForm() {
    if (!selectedFile) {
      return "Selecione um arquivo PDF.";
    }

    if (extractionState !== "ready") {
      return "Aguarde a extração dos metadados.";
    }

    if (metadata.title.trim().length === 0) {
      return "Informe um título.";
    }

    if (splitAuthors(metadata.authors).length === 0) {
      return "Informe ao menos um autor.";
    }

    if (metadata.source.trim().length === 0) {
      return "Informe a fonte.";
    }

    const year = Number(metadata.year);
    if (!Number.isInteger(year) || year < 1000 || year > 9999) {
      return "Informe um ano válido com quatro dígitos.";
    }

    if (selectedCollection.length === 0) {
      return "Selecione uma coleção.";
    }

    if (selectedTags.length === 0) {
      return "Você deve ter pelo menos uma tag";
    }

    return "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    const validationError = validateForm();

    if (validationError.length > 0 || !selectedFile) {
      setValidationMessage(validationError);
      return;
    }

    const normalizedTags = [...new Set(selectedTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];

    const document: LibraryDocument = {
      id: createDocumentId(selectedFile.name),
      title: metadata.title.trim(),
      authors: splitAuthors(metadata.authors),
      source: metadata.source.trim(),
      year: Number(metadata.year),
      tags: normalizedTags,
      status: "not-started",
      progress: 0,
      favorite: false,
      collection: selectedCollection,
      updatedAt: new Date().toISOString(),
      fileName: selectedFile.name,
      filePath: selectedFile.filePath,
      fileUrl: selectedFile.fileUrl,
      notes: "",
    };

    setIsSubmitting(true);
    setValidationMessage("");

    try {
      await onAddDocument(document);
      setIsSubmitting(false);
      onClose();
    } catch (error) {
      console.error("Nao foi possivel adicionar o PDF.", error);
      setValidationMessage(`Nao foi possivel adicionar o PDF. ${getErrorMessage(error)}`);
      setIsSubmitting(false);
    }
  }

  const canAddDocument = selectedFile !== null && extractionState === "ready" && !isSubmitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-modal p-6" role="presentation" onMouseDown={onClose}>
      <form
        className="flex max-h-[calc(100vh-48px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-surface-panel shadow-2xl"
        onSubmit={handleSubmit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-6 py-5">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <FileIcon />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-text-primary">Adicionar PDF</h2>
            <p className="text-sm text-text-secondary">Importe um artigo ou livro para a biblioteca</p>
          </div>
          <button type="button" aria-label="Fechar modal" className="rounded-md p-2 text-text-subtle hover:bg-surface-muted" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleFileInputChange} />

          <div
            className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center transition ${
              isDragging ? "border-primary bg-primary-soft" : "border-border-strong bg-surface-app hover:border-primary"
            }`}
            onClick={() => void selectNativeFile()}
            onDrop={handleDrop}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
          >
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary-soft text-primary">
              <UploadIcon />
            </div>
            <p className="text-sm font-bold text-text-primary">Arraste um PDF aqui</p>
            <p className="mt-1 text-sm text-text-secondary">ou</p>
            <button
              type="button"
              className="mt-3 rounded-lg border border-border-muted bg-surface-panel px-4 py-2 text-sm font-bold text-primary hover:bg-primary-soft"
              onClick={(event) => {
                event.stopPropagation();
                void selectNativeFile();
              }}
            >
              Procurar arquivos
            </button>
            <p className="mt-3 font-mono text-xs text-text-subtle">Apenas .pdf</p>
          </div>

          {selectedFile ? (
            <div className="mt-4 flex items-center gap-3 rounded-lg border border-border-muted bg-surface-app px-3 py-3">
              <span className="rounded-md bg-status-red px-2 py-1 font-mono text-xs font-bold text-status-red-text">PDF</span>
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{selectedFile.name}</span>
              <button
                type="button"
                className="text-sm font-semibold text-text-secondary hover:text-text-primary"
                onClick={() => {
                  clearExtractionTimer();
                  setSelectedFile(null);
                  setMetadata(emptyMetadata);
                  setExtractionState("idle");
                }}
              >
                Remover
              </button>
            </div>
          ) : null}

          {extractionState === "loading" ? (
            <div className="mt-4 rounded-lg border border-border-muted bg-surface-panel p-4">
              <div className="mb-3 h-4 w-44 animate-pulse rounded bg-surface-muted" />
              <div className="space-y-2">
                <div className="h-9 animate-pulse rounded bg-surface-muted" />
                <div className="h-9 animate-pulse rounded bg-surface-muted" />
                <div className="h-9 animate-pulse rounded bg-surface-muted" />
              </div>
            </div>
          ) : null}

          {extractionState === "ready" ? (
            <div className="mt-4 rounded-lg bg-status-green px-4 py-3 text-sm font-bold text-status-green-text">
              Metadados extraídos
            </div>
          ) : null}

          <div className="mt-5 grid gap-4">
            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-text-primary">Título</span>
              <input
                value={metadata.title}
                onChange={(event) => updateMetadataField("title", event.target.value)}
                className="rounded-lg border border-border-muted px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                placeholder="Título do documento"
              />
            </label>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-text-primary">Autores</span>
              <input
                value={metadata.authors}
                onChange={(event) => updateMetadataField("authors", event.target.value)}
                className="rounded-lg border border-border-muted px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                placeholder="Separe autores por vírgula"
              />
            </label>

            <div className="grid grid-cols-[1fr_120px] gap-3">
              <label className="grid min-w-0 gap-1.5">
                <span className="text-sm font-semibold text-text-primary">Fonte</span>
                <input
                  value={metadata.source}
                  onChange={(event) => updateMetadataField("source", event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-border-muted px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                  placeholder="Conferência, periódico ou editora"
                />
              </label>

              <label className="grid min-w-0 gap-1.5">
                <span className="text-sm font-semibold text-text-primary">Ano</span>
                <input
                  value={metadata.year}
                  inputMode="numeric"
                  onChange={(event) => updateMetadataField("year", event.target.value)}
                  className="w-full min-w-0 rounded-lg border border-border-muted px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                  placeholder="2026"
                />
              </label>
            </div>

            <label className="grid gap-1.5">
              <span className="text-sm font-semibold text-text-primary">Coleção</span>
              <select
                value={selectedCollection}
                onChange={(event) => setSelectedCollection(event.target.value)}
                className="rounded-lg border border-border-muted px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
              >
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.name}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </label>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold text-text-primary">Tags</legend>
              <TagSelector
                availableTags={availableTags}
                selectedTags={selectedTags}
                onAvailableTagsChange={onAvailableTagsChange}
                onSelectedTagsChange={setSelectedTags}
              />
            </fieldset>
          </div>

          {validationMessage.length > 0 ? (
            <div className="mt-4 rounded-lg bg-status-red px-4 py-3 text-sm font-semibold text-status-red-text">{validationMessage}</div>
          ) : null}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-3 border-t border-border-subtle px-6 py-4">
          <button type="button" className="rounded-lg px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-surface-muted" onClick={onClose}>
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!canAddDocument}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-text-inverse shadow-button transition hover:bg-primary-hover disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-text-subtle disabled:shadow-none"
          >
            Adicionar à biblioteca
          </button>
        </footer>
      </form>
    </div>
  );
}
