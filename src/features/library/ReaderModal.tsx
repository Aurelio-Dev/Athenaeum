import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { floatingPanelId, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { createAnnotation, deleteAnnotation, listAnnotations, setDocumentReadingLocation, updateAnnotationNote } from "../../lib/database";
import type { NewAnnotation } from "../../lib/database";
import type { Annotation, AnnotationSaveState, HighlightColor } from "../../types/annotation";
import type { LibraryDocument, ReadingLocation, SubjectTag } from "../../types/library";
import { captureSelection, type CapturedSelection, type PageElement } from "../reader/anchor";
import { HighlightLayer } from "../reader/HighlightLayer";
import { NotePopover } from "../reader/NotePopover";
import { PdfTextLayer } from "../reader/PdfTextLayer";
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

// Posicao inicial do painel de anotacoes flutuante: encostado a direita, logo
// abaixo do header do leitor — mesmo comportamento de antes do refactor para
// a pilha de paineis (as dimensoes espelham as do ReaderSidePanel).
function getAnnotationsPanelInitialPosition() {
  const panelWidth = 440;
  const panelHeight = 580;
  return {
    x: Math.max(8, window.innerWidth - panelWidth - 24),
    y: Math.max(76, Math.min(94, window.innerHeight - panelHeight)),
  };
}
// Escala base do PDF: o canvas e a camada de texto usam a MESMA escala para o
// texto transparente cair exatamente sobre as letras.
const pdfBaseScale = 1.1;

function pageScale(zoom: number) {
  return (zoom / 100) * pdfBaseScale;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function Icon({ name }: { name: "back" | "close" | "leftPanel" | "notes" | "prev" | "next" | "minus" | "plus" | "search" | "pen" | "split" | "maximize" | "restore" }) {
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

  if (name === "maximize") {
    return (
      <svg {...commonProps}>
        <path d="M8 4H4v4" />
        <path d="M16 4h4v4" />
        <path d="M20 16v4h-4" />
        <path d="M8 20H4v-4" />
      </svg>
    );
  }

  if (name === "restore") {
    return (
      <svg {...commonProps}>
        <path d="M8 4h12v12" />
        <path d="M4 8h12v12H4z" />
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

function getMaximizedReaderSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function centerHorizontalScroll(element: HTMLElement) {
  const scrollMax = Math.max(0, element.scrollWidth - element.clientWidth);
  element.scrollLeft = Math.round(scrollMax / 2);
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
  const [sidePanelInitialTab, setSidePanelInitialTab] = useState<"annotations" | undefined>(undefined);
  // O modo flutuante do painel de anotacoes agora vive na pilha global de
  // paineis (FloatingPanelsContext) em vez de um boolean local — assim ele
  // coexiste com outros paineis (ex.: um caderno aberto ao mesmo tempo).
  const queryClient = useQueryClient();
  const { panels: floatingPanels, openPanel, closePanel, minimizePanel, restorePanel, movePanel } = useFloatingPanels();
  const annotationsPanelId = floatingPanelId("annotations", document.id);
  const annotationsPanel = floatingPanels.find((panel) => panel.id === annotationsPanelId) ?? null;
  const sidePanelFloating = annotationsPanel !== null;
  // O proprio leitor tambem e um painel da pilha (aberto pelo LibraryView em
  // openForReading) — le a propria entrada para posicao/zIndex.
  const readerPanelId = floatingPanelId("reader", document.id);
  const readerPanel = floatingPanels.find((panel) => panel.id === readerPanelId) ?? null;
  const [readerPanelSize, setReaderPanelSize] = useState(() => ({
    width: Math.max(720, Math.min(1240, window.innerWidth - 64)),
    height: Math.max(480, Math.min(900, window.innerHeight - 96)),
  }));
  const [isReaderMaximized, setIsReaderMaximized] = useState(false);
  const readerRestoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
  } | null>(null);

  // Fechar o leitor remove os paineis dele da pilha (o proprio leitor e o de
  // anotacoes) — sem isso paineis "fantasma" continuariam registrados depois
  // do unmount.
  useEffect(() => {
    return () => {
      closePanel(annotationsPanelId);
      closePanel(readerPanelId);
    };
  }, [closePanel, annotationsPanelId, readerPanelId]);
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

  useLayoutEffect(() => {
    const readerSurface = readerSurfaceRef.current;

    if (!readerSurface) {
      return;
    }

    const center = () => centerHorizontalScroll(readerSurface);
    window.requestAnimationFrame(center);
  }, [zoom, pageSizes, readerPanelSize.width, leftPanelOpen, sidePanelOpen]);

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

    setSidePanelInitialTab("annotations");
    setSidePanelOpen(true);
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
      const updatedAt = new Date().toISOString();
      setAnnotations((current) => current.map((item) => (item.id === annotationId ? { ...item, note, updatedAt } : item)));
      setEditingAnnotationId(null);
    },
    [editingAnnotationId],
  );

  const saveAnnotationNoteById = useCallback(async (annotationId: string, note: string) => {
    await updateAnnotationNote(annotationId, note);
    const updatedAt = new Date().toISOString();
    setAnnotations((current) => current.map((item) => (item.id === annotationId ? { ...item, note, updatedAt } : item)));
  }, []);

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

  // Marca o fechamento explicito para o flush de unmount (abaixo) nao rodar
  // em duplicidade depois do closeAndSave.
  const hasClosedExplicitlyRef = useRef(false);

  const closeAndSave = useCallback(() => {
    hasClosedExplicitlyRef.current = true;
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

  // Flush no UNMOUNT sem fechamento explicito — o caso real e a troca de
  // documento no leitor (abrir outro PDF desmonta este painel sem passar pelo
  // closeAndSave). Roda o MESMO flush do fechamento (posicao exata + notas +
  // tempo de leitura), apenas sem o onClose, ja que o proximo leitor esta
  // assumindo. useLayoutEffect e obrigatorio aqui: o cleanup dele executa
  // ANTES do DOM ser destacado, entao getCurrentReadingLocation ainda consegue
  // medir o scroll (num useEffect o cleanup rodaria tarde demais e salvaria a
  // posicao zerada do fallback).
  const flushOnUnmountRef = useRef<() => void>(() => {});
  flushOnUnmountRef.current = () => {
    if (hasClosedExplicitlyRef.current) {
      return;
    }

    const readingLocation = getCurrentReadingLocation();
    flushNotes();
    void flushReadingTime();
    void setDocumentReadingLocation(document, readingLocation)
      .then(() => queryClient.invalidateQueries({ queryKey: ["library"] }))
      .catch((error) => {
        console.warn("Nao foi possivel salvar a posicao de leitura na troca de documento.", error);
      });
  };

  useLayoutEffect(() => {
    return () => flushOnUnmountRef.current();
  }, []);

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

      // O leitor e um painel da pilha: Esc so age quando ELE esta no topo.
      // Com um caderno/quadro por cima, o Esc e desse painel (que se fecha
      // sozinho), nao do leitor.
      const topPanel = [...floatingPanels].reverse().find((panel) => !panel.isMinimized);
      if (topPanel && topPanel.id !== readerPanelId) {
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
  }, [closeAndSave, editingAnnotationId, pendingSelection, floatingPanels, readerPanelId]);

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

  const toggleReaderMaximized = useCallback(() => {
    if (!readerPanel) {
      return;
    }

    if (isReaderMaximized) {
      const restoreState = readerRestoreStateRef.current;

      if (restoreState) {
        setReaderPanelSize(restoreState.size);
        movePanel(readerPanelId, restoreState.position);
      }

      setIsReaderMaximized(false);
      return;
    }

    readerRestoreStateRef.current = {
      position: readerPanel.position,
      size: readerPanelSize,
    };
    setReaderPanelSize(getMaximizedReaderSize());
    movePanel(readerPanelId, { x: 0, y: 0 });
    setIsReaderMaximized(true);
  }, [isReaderMaximized, movePanel, readerPanel, readerPanelId, readerPanelSize]);

  useEffect(() => {
    if (!isReaderMaximized) {
      return;
    }

    function handleWindowResize() {
      setReaderPanelSize(getMaximizedReaderSize());
      movePanel(readerPanelId, { x: 0, y: 0 });
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isReaderMaximized, movePanel, readerPanelId]);

  const progress = Math.round((currentPage / totalPages) * 100);
  const summaryItems = pdfOutline.length > 0 ? pdfOutline : ["Resumo", "Arquitetura", "Treinamento", "Resultados", "Conclusoes"].map((title) => ({ title }));
  const editingAnnotation = editingAnnotationId ? annotations.find((annotation) => annotation.id === editingAnnotationId) ?? null : null;

  // Entrada da pilha ainda nao criada (transitorio durante abrir/fechar).
  if (!readerPanel) {
    return null;
  }

  return (
    <FloatingPanelFrame
      panel={readerPanel}
      width={readerPanelSize.width}
      height={readerPanelSize.height}
      minWidth={720}
      minHeight={480}
      resizable={!isReaderMaximized}
      edgeToEdge={isReaderMaximized}
      onFocusPanel={() => {
        if (sidePanelFloating) {
          minimizePanel(annotationsPanelId);
        }
      }}
      // O header proprio do leitor (breadcrumb + toolbar) vira o handle de
      // drag — os controles interativos param a propagacao do mousedown para
      // nao iniciar arrasto.
      renderHeader={(startDragging) => (
        <header
          className={`flex h-11 shrink-0 items-center border-b border-[var(--reader-header-border)] bg-[var(--reader-header-bg)] text-[var(--reader-header-muted)] ${
            isReaderMaximized ? "" : "cursor-move"
          }`}
          onMouseDown={isReaderMaximized ? undefined : startDragging}
        >
        <div className="flex min-w-0 flex-1 items-center gap-3 px-5">
          <button
            type="button"
            className="rounded-md p-1.5 text-[var(--reader-header-control)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]"
            aria-label="Voltar para biblioteca"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={closeAndSave}
          >
            <Icon name="back" />
          </button>
          <h1 id="reader-title" className="min-w-0 truncate text-sm font-bold text-[var(--reader-header-text)]">
            {document.title}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-5" onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" aria-label="Reduzir zoom" className="rounded-md p-1.5 text-[var(--reader-header-control)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]" onClick={() => changeZoom(zoom - zoomStep)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="min-w-14 rounded-md px-2 py-1 text-sm font-medium text-[var(--reader-header-strong)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]" onClick={() => changeZoom(100)}>
            {zoom}%
          </button>
          <button type="button" aria-label="Aumentar zoom" className="rounded-md p-1.5 text-[var(--reader-header-control)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]" onClick={() => changeZoom(zoom + zoomStep)}>
            <Icon name="plus" />
          </button>
          <div className="mx-2 h-6 w-px bg-[var(--reader-header-divider)]" />
          <span className="min-w-16 text-center text-sm font-medium text-[var(--reader-header-strong)]">
            {currentPage} / {totalPages}
          </span>
          <div className="mx-2 h-6 w-px bg-[var(--reader-header-divider)]" />
          {isSearchOpen ? (
            <input
              value={documentSearchTerm}
              onChange={(event) => setDocumentSearchTerm(event.target.value)}
              onBlur={() => {
                if (documentSearchTerm.trim().length === 0) {
                  setIsSearchOpen(false);
                }
              }}
              className="h-8 w-52 rounded-md border border-[var(--reader-header-input-border)] bg-[var(--reader-header-input-bg)] px-3 text-sm text-[var(--reader-header-text)] outline-none placeholder:text-[var(--reader-header-muted)] focus:border-primary"
              placeholder="Buscar no documento..."
              autoFocus
            />
          ) : (
            <button type="button" aria-label="Buscar no documento" className="rounded-md p-1.5 text-[var(--reader-header-control)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]" onClick={() => setIsSearchOpen(true)}>
              <Icon name="search" />
            </button>
          )}
          <button
            type="button"
            aria-label="Modo marca-texto"
            className={`rounded-md p-1.5 transition ${isHighlightModeEnabled ? "text-primary" : "text-[var(--reader-header-control)] hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]"}`}
            onClick={() => setIsHighlightModeEnabled((isEnabled) => !isEnabled)}
          >
            <Icon name="pen" />
          </button>
          <button
            type="button"
            aria-label={sidePanelFloating ? (annotationsPanel?.isMinimized ? "Restaurar painel" : "Minimizar painel") : sidePanelOpen ? "Fechar painel" : "Abrir painel"}
            title={sidePanelFloating ? (annotationsPanel?.isMinimized ? "Restaurar painel" : "Minimizar painel") : sidePanelOpen ? "Fechar painel" : "Abrir painel"}
            className={`rounded-md p-1.5 transition ${sidePanelOpen ? "bg-[var(--reader-header-active-bg)] text-primary" : "text-[var(--reader-header-control)] hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]"}`}
            onClick={() => {
              setSidePanelInitialTab(undefined);
              if (sidePanelFloating) {
                setSidePanelOpen(true);

                if (annotationsPanel?.isMinimized) {
                  restorePanel(annotationsPanelId);
                  return;
                }

                minimizePanel(annotationsPanelId);
                return;
              }

              setSidePanelOpen((isOpen) => !isOpen);
            }}
          >
            <Icon name="split" />
          </button>
          <div className="mx-2 h-6 w-px bg-[var(--reader-header-divider)]" />
          <button
            type="button"
            aria-label={isReaderMaximized ? "Restaurar janela do leitor" : "Maximizar janela do leitor"}
            title={isReaderMaximized ? "Restaurar" : "Maximizar"}
            className="rounded-md p-1.5 text-[var(--reader-header-control)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]"
            onClick={toggleReaderMaximized}
          >
            <Icon name={isReaderMaximized ? "restore" : "maximize"} />
          </button>
          <button
            type="button"
            aria-label="Fechar leitor"
            title="Fechar"
            className="rounded-md p-1.5 text-[var(--reader-header-control)] transition hover:bg-[var(--reader-header-hover-bg)] hover:text-[var(--reader-header-text)]"
            onClick={closeAndSave}
          >
            <Icon name="close" />
          </button>
        </div>
        </header>
      )}
    >
      <div className="relative min-h-0 flex flex-1 overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
        <main ref={readerSurfaceRef} className="relative min-w-0 flex-1 overflow-auto px-5 py-10" onScroll={handleReaderScroll} onMouseUp={handleReaderMouseUp}>
          {isPdfLoading ? (
            <div className="mx-auto flex h-96 max-w-xl items-center justify-center rounded-lg bg-white text-sm font-semibold text-text-secondary shadow-card">
              Carregando PDF...
            </div>
          ) : pdfError ? (
            <div className="mx-auto max-w-xl rounded-lg bg-white px-6 py-5 text-sm font-semibold text-status-red-text shadow-card">
              {pdfError}
            </div>
          ) : (
            <div className="flex w-max min-w-full flex-col items-center gap-10">
              {pageNumbers.map((page) => (
                <div
                  key={page}
                  ref={(element) => {
                    pageRefs.current[page - 1] = element;
                  }}
                  className="w-fit"
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
            initialTab={sidePanelInitialTab}
            onFloat={() => openPanel("annotations", document.id, getAnnotationsPanelInitialPosition())}
            onDock={() => closePanel(annotationsPanelId)}
            onJumpToPage={scrollToPage}
            onDeleteAnnotation={handleDeleteAnnotationFromList}
            onUpdateAnnotationNote={saveAnnotationNoteById}
            onClose={() => {
              setSidePanelInitialTab(undefined);
              closePanel(annotationsPanelId);
              setSidePanelOpen(false);
            }}
          />
        ) : null}
      </div>

      {pendingSelection ? (
        <SelectionToolbar
          anchor={pendingSelection.anchor}
          onHighlight={highlightSelection}
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
    </FloatingPanelFrame>
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
