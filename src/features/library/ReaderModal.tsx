import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { createAnnotation, deleteAnnotation, listAnnotations, setDocumentReadingLocation, updateAnnotationNote } from "../../lib/database";
import type { NewAnnotation } from "../../lib/database";
import type { Annotation, AnnotationSaveState, HighlightColor } from "../../types/annotation";
import type { LibraryDocument, ReadingLocation, SubjectTag } from "../../types/library";
import { captureSelection, type CapturedSelection, type PageElement } from "../reader/anchor";
import { HighlightLayer } from "../reader/HighlightLayer";
import { NotePopover } from "../reader/NotePopover";
import { PdfTextLayer } from "../reader/PdfTextLayer";
import { readerPanelPopoutStorageKey } from "../reader/ReaderPanelPopout";
import { ReaderSidePanel } from "../reader/ReaderSidePanel";
import { SelectionToolbar } from "../reader/SelectionToolbar";
import { useReaderPersistence } from "../reader/useReaderPersistence";
import { useReadingTimer } from "../reader/useReadingTimer";

type PdfDocument = pdfjsLib.PDFDocumentProxy;
type PageSize = {
  width: number;
  height: number;
};
type PdfOutlineItem = {
  title: string;
};

type ReaderModalProps = {
  document: LibraryDocument;
  availableTags: SubjectTag[];
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
  onUpdateDocumentTags: (documentId: string, tags: SubjectTag[]) => void;
  onClose: (readingLocation: ReadingLocation) => void;
  onSaveNotes: (documentId: string, notes: string) => void;
};

const fallbackPageCount = 15;
const minZoom = 70;
const maxZoom = 140;
const zoomStep = 10;
// Escala base do PDF: o canvas e a camada de texto usam a MESMA escala para o
// texto transparente cair exatamente sobre as letras.
const pdfBaseScale = 1.1;

function pageScale(zoom: number) {
  return (zoom / 100) * pdfBaseScale;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function Icon({ name }: { name: "back" | "close" | "leftPanel" | "notes" | "prev" | "next" | "minus" | "plus" | "search" | "pen" | "split" }) {
  const commonProps = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "back") {
    return (
      <svg {...commonProps}>
        <path d="M19 12H5" />
        <path d="M12 19l-7-7 7-7" />
      </svg>
    );
  }

  if (name === "close") {
    return (
      <svg {...commonProps}>
        <line x1="18" x2="6" y1="6" y2="18" />
        <line x1="6" x2="18" y1="6" y2="18" />
      </svg>
    );
  }

  if (name === "leftPanel") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M9 5v14" />
      </svg>
    );
  }

  if (name === "notes") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M15 5v14" />
      </svg>
    );
  }

  if (name === "pen") {
    return (
      <svg {...commonProps}>
        <path d="m15 5 4 4" />
        <path d="M14 6 4 16v4h4L18 10" />
        <path d="M13 20h7" />
      </svg>
    );
  }

  if (name === "split") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M14 5v14" />
      </svg>
    );
  }

  if (name === "prev") {
    return (
      <svg {...commonProps}>
        <path d="M15 18l-6-6 6-6" />
      </svg>
    );
  }

  if (name === "next") {
    return (
      <svg {...commonProps}>
        <path d="M9 18l6-6-6-6" />
      </svg>
    );
  }

  if (name === "minus") {
    return (
      <svg {...commonProps}>
        <path d="M5 12h14" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg {...commonProps}>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getInitialZoom(document: LibraryDocument) {
  return clamp(document.readingLocation?.zoom ?? 100, minZoom, maxZoom);
}

function hasPdfSource(document: LibraryDocument) {
  return Boolean(document.fileUrl || document.filePath);
}

function estimatedPageSize(zoom: number): PageSize {
  const zoomRatio = zoom / 100;
  return {
    width: Math.round(850 * zoomRatio),
    height: Math.round(1120 * zoomRatio),
  };
}

function useInViewport<T extends Element>(rootMargin: string) {
  const elementRef = useRef<T | null>(null);
  const [isInViewport, setIsInViewport] = useState(false);

  useEffect(() => {
    const element = elementRef.current;
    if (!element) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInViewport(entry.isIntersecting);
      },
      { root: null, rootMargin },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin]);

  return { elementRef, isInViewport };
}

function PdfPagePlaceholder({ pageSize, label }: { pageSize: PageSize; label?: string }) {
  return (
    <article
      className="mx-auto flex items-center justify-center bg-white text-xs font-semibold text-slate-400 shadow-[0_18px_42px_rgba(15,23,42,0.18)]"
      style={{ width: pageSize.width, minHeight: pageSize.height }}
    >
      {label}
    </article>
  );
}

function base64ToBytes(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function buildFallbackPageNumbers() {
  return Array.from({ length: fallbackPageCount }, (_, index) => index + 1);
}

type PdfCanvasPageProps = {
  pdfDocument: PdfDocument;
  pageNumber: number;
  zoom: number;
  annotations: Annotation[];
  saveStates: Map<string, AnnotationSaveState>;
  onRetry: (annotationId: string) => void;
  onSelectAnnotation: (annotation: Annotation) => void;
  pageSize: PageSize;
  onPageSize: (pageNumber: number, size: PageSize) => void;
};

function PdfCanvasPage({ pdfDocument, pageNumber, zoom, annotations, saveStates, onRetry, onSelectAnnotation, pageSize, onPageSize }: PdfCanvasPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendering, setIsRendering] = useState(true);
  const scale = pageScale(zoom);

  useEffect(() => {
    let isCancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderPage() {
      setIsRendering(true);
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      onPageSize(pageNumber, { width: viewport.width, height: viewport.height });
      const canvas = canvasRef.current;
      const canvasContext = canvas?.getContext("2d");

      if (!canvas || !canvasContext || isCancelled) {
        return;
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      renderTask = page.render({
        canvasContext,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });

      await renderTask.promise;

      if (!isCancelled) {
        setIsRendering(false);
      }
    }

    renderPage().catch((error) => {
      if (!isCancelled && error?.name !== "RenderingCancelledException") {
        setIsRendering(false);
      }
    });

    return () => {
      isCancelled = true;
      renderTask?.cancel();
    };
  }, [onPageSize, pageNumber, pdfDocument, scale]);

  // article e `relative` para ancorar a camada de texto e os highlights, que
  // ficam sobrepostos ao canvas com inset-0.
  return (
    <article className="relative mx-auto bg-white shadow-[0_18px_42px_rgba(15,23,42,0.18)]" style={isRendering ? { width: pageSize.width, minHeight: pageSize.height } : undefined}>
      {isRendering ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold text-slate-400">
          Renderizando pagina {pageNumber}...
        </div>
      ) : null}
      <canvas ref={canvasRef} className={isRendering ? "hidden" : "block"} />
      {!isRendering ? (
        <>
          <PdfTextLayer pdfDocument={pdfDocument} pageNumber={pageNumber} scale={scale} />
          <HighlightLayer annotations={annotations} saveStates={saveStates} onRetry={onRetry} onSelect={onSelectAnnotation} />
        </>
      ) : null}
    </article>
  );
}

function VirtualPdfCanvasPage(props: PdfCanvasPageProps) {
  const { elementRef, isInViewport } = useInViewport<HTMLDivElement>("900px 0px");
  const [hasEnteredViewport, setHasEnteredViewport] = useState(false);

  useEffect(() => {
    if (isInViewport) {
      setHasEnteredViewport(true);
    }
  }, [isInViewport]);

  return (
    <div ref={elementRef}>
      {hasEnteredViewport ? <PdfCanvasPage {...props} /> : <PdfPagePlaceholder pageSize={props.pageSize} />}
    </div>
  );
}

function PdfThumbnail({ pdfDocument, page, active, onClick }: { pdfDocument: PdfDocument; page: number; active: boolean; onClick: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderThumbnail() {
      const pdfPage = await pdfDocument.getPage(page);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: 142 / baseViewport.width });
      const canvas = canvasRef.current;
      const canvasContext = canvas?.getContext("2d");

      if (!canvas || !canvasContext || isCancelled) {
        return;
      }

      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      renderTask = pdfPage.render({
        canvasContext,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      });

      await renderTask.promise;
    }

    renderThumbnail().catch(() => undefined);

    return () => {
      isCancelled = true;
      renderTask?.cancel();
    };
  }, [page, pdfDocument]);

  return (
    <button type="button" className="block w-full text-left" onClick={onClick}>
      <div
        className={`mx-auto overflow-hidden rounded border bg-white p-1 shadow-sm transition ${
          active ? "border-primary ring-2 ring-primary-soft" : "border-indigo-200 hover:border-primary"
        }`}
      >
        <canvas ref={canvasRef} className="block" />
      </div>
      <span className="mt-2 block text-center text-sm text-text-subtle">{page}</span>
    </button>
  );
}

function ThumbnailPlaceholder({ page, active, onClick }: { page: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="block w-full text-left" onClick={onClick}>
      <div
        className={`mx-auto h-44 w-36 overflow-hidden rounded border bg-white p-1 shadow-sm transition ${
          active ? "border-primary ring-2 ring-primary-soft" : "border-indigo-200 hover:border-primary"
        }`}
      >
        <div className="h-full w-full animate-pulse rounded bg-slate-100" />
      </div>
      <span className="mt-2 block text-center text-sm text-text-subtle">{page}</span>
    </button>
  );
}

function LazyPdfThumbnail({ pdfDocument, page, active, onClick }: { pdfDocument: PdfDocument; page: number; active: boolean; onClick: () => void }) {
  const { elementRef, isInViewport } = useInViewport<HTMLDivElement>("600px 0px");
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    if (isInViewport) {
      setHasRendered(true);
    }
  }, [isInViewport]);

  return (
    <div ref={elementRef}>
      {hasRendered ? <PdfThumbnail pdfDocument={pdfDocument} page={page} active={active} onClick={onClick} /> : <ThumbnailPlaceholder page={page} active={active} onClick={onClick} />}
    </div>
  );
}

function FallbackReaderPage({ page, zoom, document }: { page: number; zoom: number; document: LibraryDocument }) {
  const pageWidth = Math.round(850 * (zoom / 100));
  const pageHeight = Math.round(1120 * (zoom / 100));
  const compact = zoom < 90;

  return (
    <article
      className="mx-auto bg-white text-slate-950 shadow-[0_18px_42px_rgba(15,23,42,0.18)]"
      style={{ width: pageWidth, minHeight: pageHeight }}
    >
      <div className="px-[8%] py-[8%]">
        <p className="text-xs font-bold text-slate-500">
          {document.title} - Pagina {page}
        </p>
        <section className="mt-8">
          <div className="h-3 w-2/5 rounded-full bg-primary" />
          <div className="mt-4 rounded border border-indigo-200 bg-primary-soft p-5">
            <div className="h-2 w-1/3 rounded-full bg-indigo-300" />
            <div className="mt-4 space-y-2">
              <div className="h-1.5 w-full rounded-full bg-indigo-200" />
              <div className="h-1.5 w-11/12 rounded-full bg-indigo-200" />
              <div className="h-1.5 w-10/12 rounded-full bg-indigo-200" />
              <div className="h-1.5 w-8/12 rounded-full bg-indigo-200" />
            </div>
          </div>
        </section>
        <div className="mt-10 grid grid-cols-2 gap-10">
          {[0, 1].map((column) => (
            <div key={column} className="space-y-2">
              {Array.from({ length: compact ? 8 : 12 }, (_, index) => (
                <div
                  key={index}
                  className="h-1.5 rounded-full bg-slate-300"
                  style={{ width: `${index % 5 === 4 ? 62 : 100 - ((index + column) % 4) * 8}%` }}
                />
              ))}
            </div>
          ))}
        </div>
        <section className="mt-12">
          <h3 className="font-serif text-base font-bold">Secao {page}.{page % 4}</h3>
          <div className="mt-5 space-y-2">
            {Array.from({ length: compact ? 4 : 7 }, (_, index) => (
              <div key={index} className="h-1.5 rounded-full bg-slate-300" style={{ width: `${100 - (index % 3) * 12}%` }} />
            ))}
          </div>
        </section>
      </div>
    </article>
  );
}

function FallbackThumbnail({ page, active, onClick }: { page: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" className="block w-full text-left" onClick={onClick}>
      <div
        className={`mx-auto h-44 w-36 rounded border bg-white p-3 shadow-sm transition ${
          active ? "border-primary ring-2 ring-primary-soft" : "border-indigo-200 hover:border-primary"
        }`}
      >
        <div className="h-1.5 w-24 rounded-full bg-primary" />
        <div className="mt-3 space-y-1">
          {Array.from({ length: 9 }, (_, index) => (
            <div key={index} className="h-1 rounded-full bg-indigo-200" style={{ width: `${100 - (index % 4) * 9}%` }} />
          ))}
        </div>
      </div>
      <span className="mt-2 block text-center text-sm text-text-subtle">{page}</span>
    </button>
  );
}

export function ReaderModal({ document, availableTags, onAvailableTagsChange, onUpdateDocumentTags, onClose, onSaveNotes }: ReaderModalProps) {
  const fallbackPageNumbers = useMemo(buildFallbackPageNumbers, []);
  const readerSurfaceRef = useRef<HTMLElement | null>(null);
  const pageRefs = useRef<Array<HTMLElement | null>>([]);
  const [pageSizes, setPageSizes] = useState<Map<number, PageSize>>(new Map());
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [pdfError, setPdfError] = useState("");
  const [isPdfLoading, setIsPdfLoading] = useState(hasPdfSource(document));
  const [totalPages, setTotalPages] = useState(hasPdfSource(document) ? 1 : fallbackPageCount);
  const [currentPage, setCurrentPage] = useState(document.readingLocation?.page ?? Math.max(1, Math.ceil((document.progress / 100) * totalPages)));
  const [zoom, setZoom] = useState(getInitialZoom(document));
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [leftPanelTab, setLeftPanelTab] = useState<"pages" | "summary">("pages");
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [sidePanelFloating, setSidePanelFloating] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [documentSearchTerm, setDocumentSearchTerm] = useState("");
  const [isHighlightModeEnabled, setIsHighlightModeEnabled] = useState(false);
  const [notesText, setNotesText] = useState(document.notes ?? "");
  const notesSaveTimerRef = useRef<number | null>(null);
  const latestNotesRef = useRef(document.notes ?? "");
  const [documentTags, setDocumentTags] = useState<SubjectTag[]>(document.tags);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [saveStates, setSaveStates] = useState<Map<string, AnnotationSaveState>>(new Map());
  const [pendingSelection, setPendingSelection] = useState<CapturedSelection | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  // Guarda o payload de criacoes que falharam, por id otimista, para o retry.
  const failedCreatesRef = useRef<Map<string, NewAnnotation>>(new Map());

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, index) => index + 1), [totalPages]);
  const readerDocument = useMemo(
    () => ({ ...document, tags: documentTags, notes: notesText, timeSpentSeconds: document.timeSpentSeconds }),
    [document, documentTags, notesText],
  );
  const defaultPageSize = useMemo(() => estimatedPageSize(zoom), [zoom]);
  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>();
    for (const annotation of annotations) {
      const list = grouped.get(annotation.page) ?? [];
      list.push(annotation);
      grouped.set(annotation.page, list);
    }
    return grouped;
  }, [annotations]);

  useEffect(() => {
    setPageSizes(new Map());
  }, [document.id, zoom]);

  const updatePageSize = useCallback((pageNumber: number, size: PageSize) => {
    setPageSizes((current) => {
      const previous = current.get(pageNumber);
      const width = Math.round(size.width);
      const height = Math.round(size.height);

      if (previous && Math.round(previous.width) === width && Math.round(previous.height) === height) {
        return current;
      }

      const next = new Map(current);
      next.set(pageNumber, { width, height });
      return next;
    });
  }, []);
  const { timeSpentSeconds, flushReadingTime } = useReadingTimer(document.id, document.timeSpentSeconds);

  const flushNotes = useCallback(() => {
    if (notesSaveTimerRef.current !== null) {
      window.clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    }

    onSaveNotes(document.id, latestNotesRef.current);
  }, [document.id, onSaveNotes]);

  useEffect(() => {
    return () => {
      if (notesSaveTimerRef.current !== null) {
        window.clearTimeout(notesSaveTimerRef.current);
        notesSaveTimerRef.current = null;
        onSaveNotes(document.id, latestNotesRef.current);
      }
    };
  }, [document.id, onSaveNotes]);

  useEffect(() => {
    if (!hasPdfSource(document)) {
      setPdfDocument(null);
      setPdfOutline([]);
      setPdfError("");
      setIsPdfLoading(false);
      setTotalPages(fallbackPageCount);
      return;
    }

    let isCancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    setIsPdfLoading(true);
    setPdfError("");

    async function resolvePdfSource() {
      if (document.fileUrl) {
        return { url: document.fileUrl };
      }

      const base64 = await invoke<string>("read_pdf_file", { filePath: document.filePath });
      return { data: base64ToBytes(base64) };
    }

    resolvePdfSource()
      .then(async (source) => {
        if (isCancelled) {
          return;
        }

        loadingTask = pdfjsLib.getDocument(source);
        const loadedDocument = await loadingTask.promise;

        if (isCancelled) {
          return;
        }

        setPdfDocument(loadedDocument);
        setTotalPages(loadedDocument.numPages);
        setCurrentPage((page) => clamp(page, 1, loadedDocument.numPages));

        const outline = await loadedDocument.getOutline();
        if (!isCancelled) {
          setPdfOutline((outline ?? []).map((item) => ({ title: item.title })));
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setPdfError("Nao foi possivel carregar este PDF.");
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPdfLoading(false);
        }
      });

    return () => {
      isCancelled = true;
      void loadingTask?.destroy();
    };
  }, [document.fileUrl, document.filePath]);

  useEffect(() => {
    setNotesText(document.notes ?? "");
    latestNotesRef.current = document.notes ?? "";
  }, [document.id, document.notes]);

  useEffect(() => {
    setDocumentTags(document.tags);
  }, [document.id, document.tags]);

  // Carrega as anotacoes salvas ao abrir/trocar de documento.
  useEffect(() => {
    let isCancelled = false;
    setAnnotations([]);
    setSaveStates(new Map());
    failedCreatesRef.current = new Map();

    listAnnotations(document.id)
      .then((loaded) => {
        if (!isCancelled) {
          setAnnotations(loaded);
        }
      })
      .catch((error) => {
        console.warn("Nao foi possivel carregar as anotacoes.", error);
      });

    return () => {
      isCancelled = true;
    };
  }, [document.id]);

  const setSaveState = useCallback((annotationId: string, state: AnnotationSaveState) => {
    setSaveStates((current) => {
      const next = new Map(current);
      next.set(annotationId, state);
      return next;
    });
  }, []);

  const clearSaveState = useCallback((annotationId: string) => {
    setSaveStates((current) => {
      if (!current.has(annotationId)) {
        return current;
      }
      const next = new Map(current);
      next.delete(annotationId);
      return next;
    });
  }, []);

  // Criacao otimista: a anotacao ja aparece na tela com estado "saving" e so
  // vira "saved" quando o banco confirma (escrita imediata e duravel). Se falhar,
  // fica "unsaved" (visivel + retry) — nunca some sem o usuario saber.
  // Devolve a anotacao salva (com id real) ou null se a escrita falhou.
  const persistNewAnnotation = useCallback(
    async (optimisticId: string, payload: NewAnnotation): Promise<Annotation | null> => {
      setSaveState(optimisticId, "saving");
      try {
        const saved = await createAnnotation(payload);
        failedCreatesRef.current.delete(optimisticId);
        setAnnotations((current) => current.map((item) => (item.id === optimisticId ? saved : item)));
        clearSaveState(optimisticId);
        return saved;
      } catch (error) {
        console.warn("Nao foi possivel salvar a anotacao.", error);
        failedCreatesRef.current.set(optimisticId, payload);
        setSaveState(optimisticId, "unsaved");
        return null;
      }
    },
    [clearSaveState, setSaveState],
  );

  // Adiciona a anotacao de forma otimista e dispara a persistencia. Devolve o id
  // otimista e a Promise da persistencia (resolve com a anotacao salva ou null).
  const addAnnotationFromPayload = useCallback(
    (payload: NewAnnotation) => {
      const optimisticId = crypto.randomUUID();
      const now = new Date().toISOString();
      setAnnotations((current) => [...current, { id: optimisticId, createdAt: now, updatedAt: now, ...payload }]);
      return { optimisticId, persisted: persistNewAnnotation(optimisticId, payload) };
    },
    [persistNewAnnotation],
  );

  const retryAnnotation = useCallback(
    (annotationId: string) => {
      const payload = failedCreatesRef.current.get(annotationId);
      if (payload) {
        void persistNewAnnotation(annotationId, payload);
      }
    },
    [persistNewAnnotation],
  );

  function buildPayload(page: number, text: string, rects: NewAnnotation["rects"], color: HighlightColor): NewAnnotation {
    return { documentId: document.id, page, color, selectedText: text, note: "", rects };
  }

  // Cria um highlight por pagina tocada pela selecao (regra "uma anotacao por
  // pagina"). Cada pagina vira uma anotacao independente.
  const highlightSelection = useCallback((color: HighlightColor) => {
    if (!pendingSelection) {
      return;
    }

    for (const pageRects of pendingSelection.pages) {
      addAnnotationFromPayload(buildPayload(pageRects.page, pendingSelection.text, pageRects.rects, color));
    }

    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAnnotationFromPayload, document.id, pendingSelection]);

  // Como "Marcar", mas abre o editor de nota da anotacao da primeira pagina assim
  // que ela for persistida (precisamos do id real para salvar a nota depois).
  const commentSelection = useCallback((color: HighlightColor) => {
    if (!pendingSelection) {
      return;
    }

    setSidePanelOpen(true);

    pendingSelection.pages.forEach((pageRects, index) => {
      const { persisted } = addAnnotationFromPayload(buildPayload(pageRects.page, pendingSelection.text, pageRects.rects, color));
      if (index === 0) {
        void persisted.then((saved) => {
          if (saved) {
            setEditingAnnotationId(saved.id);
          }
        });
      }
    });

    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addAnnotationFromPayload, document.id, pendingSelection]);

  // Abre o editor ao clicar num highlight ja salvo. Highlights ainda nao
  // persistidos (saving/unsaved) nao abrem editor — o emblema de retry cuida deles.
  const openAnnotationEditor = useCallback(
    (annotation: Annotation) => {
      const state = saveStates.get(annotation.id) ?? "saved";
      if (state === "saved") {
        setEditingAnnotationId(annotation.id);
      }
    },
    [saveStates],
  );

  // Salva a nota de forma imediata. LANCA em caso de falha para o NotePopover
  // manter o texto e avisar — so atualiza o estado local e fecha apos confirmar.
  const saveAnnotationNote = useCallback(
    async (note: string) => {
      const annotationId = editingAnnotationId;
      if (!annotationId) {
        return;
      }

      await updateAnnotationNote(annotationId, note);
      setAnnotations((current) => current.map((item) => (item.id === annotationId ? { ...item, note } : item)));
      setEditingAnnotationId(null);
    },
    [editingAnnotationId],
  );

  // Remove a anotacao (highlight + nota). LANCA em caso de falha para o popup
  // avisar; so atualiza o estado local apos o banco confirmar.
  const removeAnnotation = useCallback(
    async (annotationId: string) => {
      await deleteAnnotation(annotationId);
      setAnnotations((current) => current.filter((item) => item.id !== annotationId));
      failedCreatesRef.current.delete(annotationId);
      clearSaveState(annotationId);
      setEditingAnnotationId((current) => (current === annotationId ? null : current));
    },
    [clearSaveState],
  );

  // Notas livres do documento: atualiza o estado local e persiste imediatamente
  // (campo unico em documents.notes, via prop do LibraryView).
  const handleNotesChange = useCallback(
    (nextNotes: string) => {
      setNotesText(nextNotes);
      latestNotesRef.current = nextNotes;

      if (notesSaveTimerRef.current !== null) {
        window.clearTimeout(notesSaveTimerRef.current);
      }

      notesSaveTimerRef.current = window.setTimeout(() => {
        notesSaveTimerRef.current = null;
        onSaveNotes(document.id, latestNotesRef.current);
      }, 500);
    },
    [document.id, onSaveNotes],
  );

  const updateTags = useCallback(
    (nextTags: SubjectTag[]) => {
      const uniqueTags = mergeUniqueTags(nextTags);
      setDocumentTags(uniqueTags);
      onAvailableTagsChange(mergeUniqueTags([...availableTags, ...uniqueTags]));
      onUpdateDocumentTags(document.id, uniqueTags);
    },
    [availableTags, document.id, onAvailableTagsChange, onUpdateDocumentTags],
  );

  const addDocumentTag = useCallback(
    (tag: SubjectTag) => {
      updateTags([...documentTags, tag]);
    },
    [documentTags, updateTags],
  );

  const removeDocumentTag = useCallback(
    (tag: SubjectTag) => {
      updateTags(documentTags.filter((currentTag) => currentTag !== tag));
    },
    [documentTags, updateTags],
  );

  // Remocao pela lista do painel: a falha so mantem o item (sem perda de dado).
  const handleDeleteAnnotationFromList = useCallback(
    (annotationId: string) => {
      void removeAnnotation(annotationId).catch((error) => {
        console.warn("Nao foi possivel remover a anotacao.", error);
      });
    },
    [removeAnnotation],
  );

  const openPanelPopout = useCallback(() => {
    window.localStorage.setItem(
      readerPanelPopoutStorageKey,
      JSON.stringify({
        documentTitle: document.title,
        notesText,
        annotations,
      }),
    );

    setSidePanelFloating(false);
    setSidePanelOpen(false);
    void invoke("open_reader_panel_window", { documentTitle: document.title }).catch((error) => {
      console.warn("Nao foi possivel abrir o painel em janela separada.", error);
    });
  }, [annotations, document.title, notesText]);

  const copySelection = useCallback(() => {
    if (!pendingSelection) {
      return;
    }

    void navigator.clipboard.writeText(pendingSelection.text).catch((error) => {
      console.warn("Nao foi possivel copiar a selecao.", error);
    });
    window.getSelection()?.removeAllRanges();
    setPendingSelection(null);
  }, [pendingSelection]);

  // Le a selecao atual do navegador no fim de cada interacao de mouse sobre a
  // area de leitura e posiciona a toolbar (ou a esconde, se nao houver selecao).
  const handleReaderMouseUp = useCallback(() => {
    if (!pdfDocument) {
      return;
    }

    const pageElements: PageElement[] = [];
    pageRefs.current.forEach((element, index) => {
      if (element) {
        pageElements.push({ page: index + 1, element });
      }
    });

    setPendingSelection(captureSelection(pageElements));
  }, [pdfDocument]);

  const scrollToPage = useCallback((page: number) => {
    const readerSurface = readerSurfaceRef.current;
    const pageElement = pageRefs.current[page - 1];

    if (!readerSurface || !pageElement) {
      return;
    }

    readerSurface.scrollTo({
      top: pageElement.offsetTop - 24,
      behavior: "smooth",
    });
  }, []);

  const getCurrentReadingLocation = useCallback((): ReadingLocation => {
    const readerSurface = readerSurfaceRef.current;

    if (!readerSurface) {
      return {
        scrollTop: 0,
        scrollRatio: document.readingLocation?.scrollRatio ?? 0,
        scrollMax: 0,
        canMeasure: false,
        page: currentPage,
        pageOffset: document.readingLocation?.pageOffset ?? 0,
        zoom,
        savedAt: new Date().toISOString(),
      };
    }

    const scrollMax = Math.max(0, readerSurface.scrollHeight - readerSurface.clientHeight);
    const scrollTop = Math.min(scrollMax, Math.max(0, readerSurface.scrollTop));
    const pageIndex = Math.max(0, Math.min(totalPages - 1, currentPage - 1));
    const pageElement = pageRefs.current[pageIndex];

    return {
      scrollTop,
      scrollRatio: scrollMax > 0 ? scrollTop / scrollMax : 0,
      scrollMax,
      canMeasure: scrollMax > 0,
      page: currentPage,
      pageOffset: pageElement ? Math.max(0, scrollTop - pageElement.offsetTop) : 0,
      zoom,
      savedAt: new Date().toISOString(),
    };
  }, [currentPage, document.readingLocation?.pageOffset, document.readingLocation?.scrollRatio, totalPages, zoom]);

  const closeAndSave = useCallback(() => {
    const readingLocation = getCurrentReadingLocation();
    flushNotes();
    void flushReadingTime().finally(() => onClose(readingLocation));
  }, [flushNotes, flushReadingTime, getCurrentReadingLocation, onClose]);

  // Autosave da posicao de leitura DURANTE a leitura. Escrita imediata de 1
  // statement (reading_location_json/progress), agendada com debounce para nao
  // gravar a cada evento de scroll. O flush exato no fechamento fica com o
  // closeAndSave (onClose) acima.
  const persistReadingLocation = useCallback(() => {
    void setDocumentReadingLocation(document, getCurrentReadingLocation()).catch((error) => {
      console.warn("Nao foi possivel salvar a posicao de leitura.", error);
    });
  }, [document, getCurrentReadingLocation]);

  const { schedule: scheduleReadingSave } = useReaderPersistence(persistReadingLocation, 750);

  useEffect(() => {
    const readerSurface = readerSurfaceRef.current;
    const location = document.readingLocation;

    if (!readerSurface || !location?.canMeasure || isPdfLoading) {
      return;
    }

    const restorePosition = () => {
      const pageElement = pageRefs.current[Math.max(0, Math.min(totalPages - 1, location.page - 1))];
      const scrollMax = Math.max(0, readerSurface.scrollHeight - readerSurface.clientHeight);
      const targetTop = pageElement ? pageElement.offsetTop + (location.pageOffset ?? 0) : location.scrollRatio * scrollMax;
      readerSurface.scrollTop = Math.min(scrollMax, Math.max(0, targetTop));
    };

    window.requestAnimationFrame(restorePosition);
    const restoreTimer = window.setTimeout(restorePosition, 500);
    return () => window.clearTimeout(restoreTimer);
  }, [document.id, document.readingLocation, isPdfLoading, pdfDocument, totalPages]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }

      // Com o popup de nota aberto, o proprio NotePopover trata o Esc; aqui so
      // garantimos que o leitor nao feche por baixo dele.
      if (editingAnnotationId) {
        return;
      }

      // Esc primeiro fecha a toolbar de selecao; so fecha o leitor se nao houver
      // selecao ativa.
      if (pendingSelection) {
        window.getSelection()?.removeAllRanges();
        setPendingSelection(null);
        return;
      }

      closeAndSave();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAndSave, editingAnnotationId, pendingSelection]);

  function handleReaderScroll() {
    // A toolbar e posicionada por coordenadas de viewport; ao rolar ela ficaria
    // deslocada, entao escondemos a selecao pendente.
    if (pendingSelection) {
      setPendingSelection(null);
    }

    const readerSurface = readerSurfaceRef.current;

    if (!readerSurface) {
      return;
    }

    const anchor = readerSurface.scrollTop + 120;
    let activePage = 1;
    pageRefs.current.forEach((pageElement, index) => {
      if (pageElement && pageElement.offsetTop <= anchor) {
        activePage = index + 1;
      }
    });
    setCurrentPage(activePage);
    scheduleReadingSave();
  }

  function changeZoom(nextZoom: number) {
    setZoom(clamp(nextZoom, minZoom, maxZoom));
    scheduleReadingSave();
  }

  const progress = Math.round((currentPage / totalPages) * 100);
  const scrollProgress = getCurrentReadingLocation().canMeasure ? Math.round(getCurrentReadingLocation().scrollRatio * 100) : progress;
  const summaryItems = pdfOutline.length > 0 ? pdfOutline : ["Resumo", "Arquitetura", "Treinamento", "Resultados", "Conclusoes"].map((title) => ({ title }));
  const editingAnnotation = editingAnnotationId ? annotations.find((annotation) => annotation.id === editingAnnotationId) ?? null : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--background)] text-[var(--foreground)]" role="dialog" aria-modal="true" aria-labelledby="reader-title">
      <header className="flex h-11 shrink-0 items-center border-b border-[#2A1A12] bg-[var(--surface-header)] text-[#9E8878]">
        <div className="flex min-w-0 flex-1 items-center gap-3 px-5">
          <button type="button" className="rounded-md p-1.5 text-[#9E8878] transition hover:bg-white/5 hover:text-white" aria-label="Voltar para biblioteca" onClick={closeAndSave}>
            <Icon name="back" />
          </button>
          <h1 id="reader-title" className="min-w-0 truncate text-sm">
            <span>Minha Biblioteca</span>
            <span className="px-1.5">/</span>
            <span>{document.collection}</span>
            <span className="px-1.5">/</span>
            <span className="font-bold text-white">{document.title}</span>
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-5">
          <button type="button" aria-label="Reduzir zoom" className="rounded-md p-1.5 text-[#9E8878] transition hover:bg-white/5 hover:text-white" onClick={() => changeZoom(zoom - zoomStep)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="min-w-14 rounded-md px-2 py-1 text-sm font-medium text-[#C7B5A6] transition hover:bg-white/5 hover:text-white" onClick={() => changeZoom(100)}>
            {zoom}%
          </button>
          <button type="button" aria-label="Aumentar zoom" className="rounded-md p-1.5 text-[#9E8878] transition hover:bg-white/5 hover:text-white" onClick={() => changeZoom(zoom + zoomStep)}>
            <Icon name="plus" />
          </button>
          <div className="mx-2 h-6 w-px bg-white/10" />
          <span className="min-w-16 text-center text-sm font-medium text-[#C7B5A6]">
            {currentPage} / {totalPages}
          </span>
          <div className="mx-2 h-6 w-px bg-white/10" />
          {isSearchOpen ? (
            <input
              value={documentSearchTerm}
              onChange={(event) => setDocumentSearchTerm(event.target.value)}
              onBlur={() => {
                if (documentSearchTerm.trim().length === 0) {
                  setIsSearchOpen(false);
                }
              }}
              className="h-8 w-52 rounded-md border border-white/10 bg-white/5 px-3 text-sm text-white outline-none placeholder:text-[#9E8878] focus:border-primary"
              placeholder="Buscar no documento..."
              autoFocus
            />
          ) : (
            <button type="button" aria-label="Buscar no documento" className="rounded-md p-1.5 text-[#9E8878] transition hover:bg-white/5 hover:text-white" onClick={() => setIsSearchOpen(true)}>
              <Icon name="search" />
            </button>
          )}
          <button
            type="button"
            aria-label="Modo marca-texto"
            className={`rounded-md p-1.5 transition ${isHighlightModeEnabled ? "text-primary" : "text-[#9E8878] hover:bg-white/5 hover:text-white"}`}
            onClick={() => setIsHighlightModeEnabled((isEnabled) => !isEnabled)}
          >
            <Icon name="pen" />
          </button>
          <button
            type="button"
            aria-label={sidePanelOpen ? "Fechar painel" : "Abrir painel"}
            className={`rounded-md p-1.5 transition ${sidePanelOpen ? "bg-primary/20 text-primary" : "text-[#9E8878] hover:bg-white/5 hover:text-white"}`}
            onClick={() => setSidePanelOpen((isOpen) => !isOpen)}
          >
            <Icon name="split" />
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex flex-1 overflow-hidden bg-[var(--background)]">
        <main ref={readerSurfaceRef} className="relative min-w-0 flex-1 overflow-y-auto px-5 py-10" onScroll={handleReaderScroll} onMouseUp={handleReaderMouseUp}>
          <div className="sticky top-0 z-10 -mx-5 -mt-10 mb-8 h-0.5 bg-transparent">
            <div className="h-full bg-primary" style={{ width: `${scrollProgress}%` }} />
          </div>
          {isPdfLoading ? (
            <div className="mx-auto flex h-96 max-w-xl items-center justify-center rounded-lg bg-white text-sm font-semibold text-text-secondary shadow-card">
              Carregando PDF...
            </div>
          ) : pdfError ? (
            <div className="mx-auto max-w-xl rounded-lg bg-white px-6 py-5 text-sm font-semibold text-status-red-text shadow-card">
              {pdfError}
            </div>
          ) : (
            <div className="space-y-10">
              {pageNumbers.map((page) => (
                <div
                  key={page}
                  ref={(element) => {
                    pageRefs.current[page - 1] = element;
                  }}
                  className="mx-auto w-fit max-w-[700px]"
                >
                  {pdfDocument ? (
                    <VirtualPdfCanvasPage
                      pdfDocument={pdfDocument}
                      pageNumber={page}
                      zoom={zoom}
                      pageSize={pageSizes.get(page) ?? defaultPageSize}
                      annotations={annotationsByPage.get(page) ?? []}
                      saveStates={saveStates}
                      onRetry={retryAnnotation}
                      onSelectAnnotation={openAnnotationEditor}
                      onPageSize={updatePageSize}
                    />
                  ) : (
                    <FallbackReaderPage page={page} zoom={zoom} document={document} />
                  )}
                </div>
              ))}
            </div>
          )}
        </main>

        {sidePanelOpen ? (
          <ReaderSidePanel
            document={readerDocument}
            notesText={notesText}
            onNotesChange={handleNotesChange}
            onNotesBlur={flushNotes}
            availableTags={availableTags}
            onAddTag={addDocumentTag}
            onRemoveTag={removeDocumentTag}
            annotations={annotations}
            progress={progress}
            timeSpentSeconds={timeSpentSeconds}
            isFloating={sidePanelFloating}
            onFloat={openPanelPopout}
            onDock={() => setSidePanelFloating(false)}
            onJumpToPage={scrollToPage}
            onDeleteAnnotation={handleDeleteAnnotationFromList}
            onClose={() => {
              setSidePanelFloating(false);
              setSidePanelOpen(false);
            }}
          />
        ) : null}
      </div>

      {pendingSelection ? (
        <SelectionToolbar
          anchor={pendingSelection.anchor}
          onHighlight={highlightSelection}
          onComment={commentSelection}
          onCopy={copySelection}
        />
      ) : null}

      {editingAnnotation ? (
        <NotePopover
          selectedText={editingAnnotation.selectedText}
          initialNote={editingAnnotation.note}
          onCancel={() => setEditingAnnotationId(null)}
          onSave={saveAnnotationNote}
          onDelete={() => removeAnnotation(editingAnnotation.id)}
        />
      ) : null}
    </div>
  );
}

function mergeUniqueTags(tags: SubjectTag[]) {
  const seenTags = new Set<string>();

  return tags
    .map((tag) => tag.trim().replace(/\s+/g, " "))
    .filter((tag) => {
      if (tag.length === 0) {
        return false;
      }

      const key = tag.toLocaleLowerCase("pt-BR");

      if (seenTags.has(key)) {
        return false;
      }

      seenTags.add(key);
      return true;
    });
}
