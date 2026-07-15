import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { useQueryClient } from "@tanstack/react-query";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { floatingPanelId, getCenteredPanelPosition, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { HeartIcon } from "../../components/ui/SharedIcons";
import { useContextMenu } from "../../hooks/useContextMenu";
import {
  createAnnotation,
  deleteAnnotation,
  getDocumentNotes,
  openDocumentExternally,
  isReaderDocumentPayload,
  isReaderOpenNotebookPayload,
  isReaderInvalidationPayload,
  isReaderJumpToPagePayload,
  isReaderPopoutCloseRequestPayload,
  listAnnotations,
  READER_ANNOTATIONS_CHANGED_EVENT,
  READER_DETAILS_CHANGED_EVENT,
  READER_JUMP_TO_PAGE_EVENT,
  READER_NOTES_CHANGED_EVENT,
  READER_OPEN_NOTEBOOK_EVENT,
  READER_PAGE_STATE_CHANGED_EVENT,
  READER_PAGE_STATE_REQUESTED_EVENT,
  READER_PANEL_WINDOW_LABEL,
  READER_POPOUT_CLOSED_EVENT,
  READER_POPOUT_FLUSHED_EVENT,
  READER_REQUEST_POPOUT_CLOSE_EVENT,
  getSetting,
  setDocumentReadingLocation,
  setSetting,
  updateAnnotationNote,
} from "../../lib/database";
import type { NewAnnotation, ReaderPageStatePayload, ReaderPopoutCloseRequestPayload } from "../../lib/database";
import type { Annotation, AnnotationSaveState, HighlightColor } from "../../types/annotation";
import type { LibraryDocument, ReadingLocation } from "../../types/library";
import { useInViewport } from "../../hooks/useInViewport";
import { captureSelection, type CapturedSelection, type PageElement } from "../reader/anchor";
import { HighlightLayer } from "../reader/HighlightLayer";
import { NotePopover } from "../reader/NotePopover";
import { PdfTextLayer } from "../reader/PdfTextLayer";
import { ReaderAnnotationsDock } from "../reader/ReaderAnnotationsDock";
import { ReaderFloatingChrome, ReaderToolRail } from "../reader/ReaderChrome";
import { ReaderLeftSidebar, readerLeftSidebarWidth, type PdfOutlineItem } from "../reader/ReaderLeftSidebar";
import { analyzePdfPageVisibleContent } from "../reader/pdfVisibleContent";
import {
  calculateReaderFitZoom,
  defaultReaderViewPreferences,
  fullPageContentBounds,
  getReaderPageGroup,
  getReaderProgressPage,
  groupReaderPages,
  parseReaderViewPreferences,
  type NormalizedContentBounds,
  type ReaderFitPage,
  type ReaderPageLayout,
  type ReaderViewPreferences,
  type ReaderZoomMode,
} from "../reader/readerView";
import { ReaderSidePanel } from "../reader/ReaderSidePanel";
import { ExternalLinkIcon } from "../reader/panels/readerPanelIcons";
import { SelectionToolbar } from "../reader/SelectionToolbar";
import { useReaderPersistence } from "../reader/useReaderPersistence";
import { useReadingTimer } from "../reader/useReadingTimer";
import { notebookPanelHeight, notebookPanelWidth } from "../notebooks/notebookPanelDimensions";

type PdfDocument = pdfjsLib.PDFDocumentProxy;
type PageSize = {
  width: number;
  height: number;
};

type ReaderPanelGeometry = {
  position: { x: number; y: number };
  size: { width: number; height: number };
};

type VisibleFitAlignment = {
  requestId: number;
  activePage: number;
  pageNumbers: number[];
  boundsByPage: Map<number, NormalizedContentBounds>;
  expectedSizes: Map<number, PageSize>;
  targetZoom: number;
};

type PendingZoomAnchor = {
  page: number;
  pageOffsetRatio: number;
  expectedPageHeight: number;
  targetZoom: number;
};

type ReaderModalProps = {
  document: LibraryDocument;
  // Estado inicial maximizado/restaurado, lido da preferencia persistida pelo
  // LibraryView antes de abrir o painel. A tela cheia nativa e independente.
  initialMaximized: boolean;
  onClose: (readingLocation: ReadingLocation) => void;
  onSaveNotes: (documentId: string, notes: string) => Promise<void>;
  onNotesReloaded: (documentId: string, notes: string) => void;
  onToggleFavorite: (documentId: string) => Promise<void>;
};

const fallbackPageCount = 15;
const minZoom = 10;
const maxZoom = 200;
const zoomStep = 10;
const pinchZoomThreshold = 36;
const pinchZoomResetDelayMs = 180;
const readerMinWidth = 720;
const readerMinHeight = 480;
const popoutFlushTimeoutMs = 5000;
const readerTopInset = 86;
const readerBottomInset = 198;
const readerSideInset = 22;
const readerReadingInset = 40;
const readerReadingModeInset = 24;
const readerPageGap = 24;
const readerModeTransitionMs = 220;
const readerViewPreferencesSettingKey = "reader.view-preferences";

// Coordena a janela nativa entre instancias consecutivas do Reader. A troca
// de PDF desmonta uma instancia e monta outra sem aguardar efeitos assincronos;
// estes marcadores impedem o cleanup antigo de retirar a nova da tela cheia.
let activeReaderInstanceToken: symbol | null = null;
let readerNativeFullscreenSessionActive = false;
let readerNativeFullscreenTransitionPromise: Promise<void> | null = null;

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

function mergeAnnotationsPreservingPending(
  persistedAnnotations: Annotation[],
  currentAnnotations: Annotation[],
  currentSaveStates: ReadonlyMap<string, AnnotationSaveState>,
) {
  const pendingAnnotations = currentAnnotations.filter(
    (annotation) => (currentSaveStates.get(annotation.id) ?? "saved") !== "saved",
  );
  const pendingIds = new Set(pendingAnnotations.map((annotation) => annotation.id));

  return [
    ...persistedAnnotations.filter((annotation) => !pendingIds.has(annotation.id)),
    ...pendingAnnotations,
  ];
}
// Escala base do PDF: o canvas e a camada de texto usam a MESMA escala para o
// texto transparente cair exatamente sobre as letras.
const pdfBaseScale = 1.1;

function pageScale(zoom: number) {
  return (zoom / 100) * pdfBaseScale;
}

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

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

// Tamanho padrao do leitor restaurado (espelha getReaderInitialPosition do
// LibraryView). Tambem e o fallback ao restaurar um leitor que abriu
// maximizado e nunca teve tamanho/posicao proprios.
function getDefaultReaderSize() {
  return clampReaderSizeToViewport({
    width: Math.max(readerMinWidth, Math.min(1240, window.innerWidth - 64)),
    height: Math.max(readerMinHeight, Math.min(900, window.innerHeight - 96)),
  });
}

function clampReaderSizeToViewport(size: { width: number; height: number }) {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  return {
    width: Math.min(viewportWidth, Math.max(Math.min(readerMinWidth, viewportWidth), size.width)),
    height: Math.min(viewportHeight, Math.max(Math.min(readerMinHeight, viewportHeight), size.height)),
  };
}

function clampReaderPositionToViewport(
  position: { x: number; y: number },
  size: { width: number; height: number },
) {
  return {
    x: Math.max(0, Math.min(position.x, window.innerWidth - Math.min(size.width, window.innerWidth))),
    y: Math.max(0, Math.min(position.y, window.innerHeight - Math.min(size.height, window.innerHeight))),
  };
}

function getDefaultReaderPosition(size: { width: number; height: number }) {
  return {
    x: Math.max(0, Math.round((window.innerWidth - size.width) / 2)),
    y: Math.max(0, Math.min(84, window.innerHeight - size.height)),
  };
}

function centerHorizontalScroll(element: HTMLElement) {
  const scrollMax = Math.max(0, element.scrollWidth - element.clientWidth);
  element.scrollLeft = Math.round(scrollMax / 2);
}

function getPageAlignedScrollTop(pageElement: HTMLElement, topInset: number) {
  return Math.max(0, pageElement.offsetTop - topInset);
}

function PdfPagePlaceholder({ pageSize, label }: { pageSize: PageSize; label?: string }) {
  return (
    <article
      className="mx-auto flex items-center justify-center bg-white text-xs font-semibold text-slate-400 shadow-[var(--reader-page-shadow)]"
      style={{ width: pageSize.width, minHeight: pageSize.height }}
    >
      {label}
    </article>
  );
}

// Resolve o numero de pagina (1-based) de cada item do sumario do PDF. O
// destino pode ser nomeado (string) ou explicito (array cujo primeiro elemento
// e a referencia da pagina); itens sem destino resolvivel ficam sem pagina e a
// sidebar os exibe nao-clicaveis.
async function resolveOutlineWithPages(pdfDocument: PdfDocument): Promise<PdfOutlineItem[]> {
  const outline = (await pdfDocument.getOutline()) ?? [];

  return Promise.all(
    outline.map(async (item) => {
      try {
        const destination = typeof item.dest === "string" ? await pdfDocument.getDestination(item.dest) : item.dest;
        const pageRef = Array.isArray(destination) ? destination[0] : null;

        if (pageRef) {
          const pageIndex = await pdfDocument.getPageIndex(pageRef);
          return { title: item.title, page: pageIndex + 1 };
        }
      } catch {
        // Destino invalido/corrompido: mantem o titulo sem pagina.
      }

      return { title: item.title };
    }),
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

type PdfCanvasPageProps = {
  pdfDocument: PdfDocument;
  pageNumber: number;
  zoom: number;
  annotations: Annotation[];
  saveStates: Map<string, AnnotationSaveState>;
  onRetry: (annotationId: string) => void;
  onSelectAnnotation: (annotation: Annotation) => void;
  pageSize: PageSize;
  onPageSize: (pageNumber: number, size: PageSize, renderedZoom: number) => void;
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
      if (isCancelled) {
        return;
      }

      const viewport = page.getViewport({ scale });
      onPageSize(pageNumber, { width: viewport.width, height: viewport.height }, zoom);
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
  }, [onPageSize, pageNumber, pdfDocument, scale, zoom]);

  // article e `relative` para ancorar a camada de texto e os highlights, que
  // ficam sobrepostos ao canvas com inset-0.
  return (
    <article className="relative mx-auto bg-white shadow-[var(--reader-page-shadow)]" style={isRendering ? { width: pageSize.width, minHeight: pageSize.height } : undefined}>
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

  return (
    <div ref={elementRef}>
      {isInViewport ? <PdfCanvasPage {...props} /> : <PdfPagePlaceholder pageSize={props.pageSize} />}
    </div>
  );
}

function FallbackReaderPage({ page, zoom, document }: { page: number; zoom: number; document: LibraryDocument }) {
  const pageWidth = Math.round(850 * (zoom / 100));
  const pageHeight = Math.round(1120 * (zoom / 100));
  const compact = zoom < 90;

  return (
    <article
      className="mx-auto bg-white text-slate-950 shadow-[var(--reader-page-shadow)]"
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

export function ReaderModal({
  document,
  initialMaximized,
  onClose,
  onSaveNotes,
  onNotesReloaded,
  onToggleFavorite,
}: ReaderModalProps) {
  const readerInstanceTokenRef = useRef(Symbol(`reader-${document.id}`));
  const readerSurfaceRef = useRef<HTMLElement | null>(null);
  const pinchZoomAccumulatorRef = useRef(0);
  const pinchZoomResetTimerRef = useRef<number | null>(null);
  const readerContextMenuOpenedByKeyboardRef = useRef(false);
  const readerContextMenu = useContextMenu();
  const pageRefs = useRef<Array<HTMLElement | null>>([]);
  const activePageLockRef = useRef<{ page: number; expiresAt: number } | null>(null);
  const leftIslandRef = useRef<HTMLDivElement | null>(null);
  const dockIslandRef = useRef<HTMLDivElement | null>(null);
  const readingModeExitButtonRef = useRef<HTMLButtonElement | null>(null);
  const visibleContentCacheRef = useRef<Map<number, Promise<NormalizedContentBounds>>>(new Map());
  const visibleContentAbortControllerRef = useRef(new AbortController());
  const visibleContentGenerationRef = useRef(0);
  const fitRequestSequenceRef = useRef(0);
  const pendingVisibleAlignmentRef = useRef<VisibleFitAlignment | null>(null);
  const pendingZoomAnchorRef = useRef<PendingZoomAnchor | null>(null);
  const readingModeTransitionAnchorRef = useRef<Pick<PendingZoomAnchor, "page" | "pageOffsetRatio"> | null>(null);
  const readingRestoreSequenceRef = useRef(0);
  const pageBaseSizesRef = useRef<Map<number, PageSize>>(new Map());
  const [pageSizes, setPageSizes] = useState<Map<number, PageSize>>(new Map());
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const pdfDocumentRef = useRef<PdfDocument | null>(pdfDocument);
  pdfDocumentRef.current = pdfDocument;
  const activeDocumentIdRef = useRef(document.id);
  activeDocumentIdRef.current = document.id;
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [pdfError, setPdfError] = useState("");
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(hasPdfSource(document));
  const [totalPages, setTotalPages] = useState(hasPdfSource(document) ? 1 : fallbackPageCount);
  const [currentPage, setCurrentPage] = useState(document.readingLocation?.page ?? Math.max(1, Math.ceil((document.progress / 100) * totalPages)));
  const [zoom, setZoom] = useState(getInitialZoom(document));
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const [viewAlignmentRevision, setViewAlignmentRevision] = useState(0);
  const [zoomMode, setZoomMode] = useState<ReaderZoomMode>("custom");
  const [pageLayout, setPageLayout] = useState<ReaderPageLayout>(defaultReaderViewPreferences.pageLayout);
  const [continuousScroll, setContinuousScroll] = useState(defaultReaderViewPreferences.continuousScroll);
  const [showCover, setShowCover] = useState(defaultReaderViewPreferences.showCover);
  const [viewPreferencesLoaded, setViewPreferencesLoaded] = useState(false);
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isFullscreenTransitioning, setIsFullscreenTransitioning] = useState(false);
  const [isTogglingFavoriteFromContextMenu, setIsTogglingFavoriteFromContextMenu] = useState(false);
  const [isOpeningOriginalFromContextMenu, setIsOpeningOriginalFromContextMenu] = useState(false);
  const [readerActionError, setReaderActionError] = useState("");
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  // Incrementado no Ctrl+F para a sidebar focar o campo de busca depois de
  // renderizada (sinal deterministico, sem timers de foco).
  const [searchFocusSignal, setSearchFocusSignal] = useState(0);
  // Sinaliza para a doca inferior que o campo de nota deve receber foco. A
  // nota continua estritamente vinculada a uma selecao capturada no PDF.
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  // O modo flutuante do painel de anotacoes agora vive na pilha global de
  // paineis (FloatingPanelsContext) em vez de um boolean local — assim ele
  // coexiste com outros paineis (ex.: um caderno aberto ao mesmo tempo).
  const queryClient = useQueryClient();
  const { panels: floatingPanels, openPanel, closePanel, minimizePanel, movePanel } = useFloatingPanels();
  const annotationsPanelId = floatingPanelId("annotations", document.id);
  const annotationsPanel = floatingPanels.find((panel) => panel.id === annotationsPanelId) ?? null;
  const sidePanelFloating = annotationsPanel !== null;
  // O proprio leitor tambem e um painel da pilha (aberto pelo LibraryView em
  // openForReading) — le a propria entrada para posicao/zIndex.
  const readerPanelId = floatingPanelId("reader", document.id);
  const readerPanel = floatingPanels.find((panel) => panel.id === readerPanelId) ?? null;
  const [readerPanelSize, setReaderPanelSize] = useState(() =>
    initialMaximized ? getMaximizedReaderSize() : getDefaultReaderSize(),
  );
  const isReaderMaximized = initialMaximized;
  const nativeFullscreenRestoreStateRef = useRef<ReaderPanelGeometry | null>(null);
  const nativeFullscreenOwnedRef = useRef(false);
  const isNativeFullscreenRef = useRef(false);
  const fullscreenTransitioningRef = useRef(false);
  const fullscreenTransitionPromiseRef = useRef<Promise<void> | null>(null);
  const fullscreenSyncSequenceRef = useRef(0);

  useLayoutEffect(() => {
    const token = readerInstanceTokenRef.current;
    activeReaderInstanceToken = token;

    return () => {
      if (activeReaderInstanceToken === token) {
        activeReaderInstanceToken = null;
      }
    };
  }, []);

  // Fechar o leitor remove os paineis dele da pilha (o proprio leitor e o de
  // anotacoes) — sem isso paineis "fantasma" continuariam registrados depois
  // do unmount.
  useEffect(() => {
    return () => {
      closePanel(annotationsPanelId);
      closePanel(readerPanelId);
    };
  }, [closePanel, annotationsPanelId, readerPanelId]);
  const [notesText, setNotesText] = useState(document.notes ?? "");
  const notesSaveTimerRef = useRef<number | null>(null);
  const latestNotesRef = useRef(document.notes ?? "");
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [saveStates, setSaveStates] = useState<Map<string, AnnotationSaveState>>(new Map());
  const saveStatesRef = useRef<Map<string, AnnotationSaveState>>(new Map());
  const notesReloadSequenceRef = useRef(0);
  const annotationsReloadSequenceRef = useRef(0);
  const [popoutDocumentId, setPopoutDocumentId] = useState<string | null>(null);
  const popoutDocumentIdRef = useRef<string | null>(null);
  const closePopoutPromiseRef = useRef<Promise<boolean> | null>(null);
  const [pendingSelection, setPendingSelection] = useState<CapturedSelection | null>(null);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  // Guarda o payload de criacoes que falharam, por id otimista, para o retry.
  const failedCreatesRef = useRef<Map<string, NewAnnotation>>(new Map());
  const currentPageStateRef = useRef<ReaderPageStatePayload>({
    documentId: document.id,
    page: currentPage,
    progress: Math.round((currentPage / totalPages) * 100),
    totalPages: null,
    fileSizeBytes: null,
  });

  const updatePopoutDocumentId = useCallback((nextDocumentId: string | null) => {
    popoutDocumentIdRef.current = nextDocumentId;
    setPopoutDocumentId(nextDocumentId);
  }, []);

  const pageGroups = useMemo(
    () => groupReaderPages(totalPages, pageLayout, pageLayout === "spread" && showCover),
    [pageLayout, showCover, totalPages],
  );
  const currentPageGroup = useMemo(
    () => getReaderPageGroup(pageGroups, currentPage),
    [currentPage, pageGroups],
  );
  const progressPage = getReaderProgressPage(currentPageGroup, currentPage);

  currentPageStateRef.current = {
    documentId: document.id,
    page: currentPage,
    progress: Math.round((progressPage / totalPages) * 100),
    totalPages: pdfDocument?.numPages ?? null,
    fileSizeBytes,
  };
  const currentPageGroupIndex = Math.max(
    0,
    pageGroups.findIndex((group) => group.includes(currentPage)),
  );
  const visiblePageLabel = currentPageGroup.length > 1
    ? `${currentPageGroup[0]}–${currentPageGroup[currentPageGroup.length - 1]}`
    : String(currentPageGroup[0] ?? currentPage);
  const readerDocument = useMemo(
    () => ({ ...document, notes: notesText, timeSpentSeconds: document.timeSpentSeconds }),
    [document, notesText],
  );
  const defaultPageSize = useMemo(() => estimatedPageSize(zoom), [zoom]);
  const isCompactReader = readerPanelSize.width < 1000;
  const activeTopInset = isReadingMode ? readerReadingModeInset : readerTopInset;
  const activeBottomInset = isReadingMode ? readerReadingModeInset : readerBottomInset;
  const readingLeftInset =
    isReadingMode
      ? readerReadingModeInset
      : !isCompactReader && leftPanelOpen
      ? readerSideInset + readerLeftSidebarWidth + 16
      : readerReadingInset;
  const readingRightInset = isReadingMode
    ? readerReadingModeInset
    : isCompactReader
      ? 24
      : readerReadingInset;
  const currentPageSize = pageSizes.get(currentPage) ?? defaultPageSize;
  const readingLaneWidth = Math.max(0, readerPanelSize.width - readingLeftInset - readingRightInset);
  const currentGroupWidth = currentPageGroup.reduce(
    (width, page) => width + (pageSizes.get(page) ?? defaultPageSize).width,
    readerPageGap * Math.max(0, currentPageGroup.length - 1),
  ) + (
    pageLayout === "spread" && showCover && currentPageGroup.length === 1 && currentPageGroup[0] === 1
      ? currentPageSize.width + readerPageGap
      : 0
  );
  const visiblePageWidth = Math.min(currentGroupWidth || currentPageSize.width, readingLaneWidth);
  const pageRightEdge = readingLeftInset + (readingLaneWidth + visiblePageWidth) / 2;
  const toolRailRight = isCompactReader
    ? readerSideInset
    : Math.max(readerSideInset, Math.round(readerPanelSize.width - pageRightEdge - 26));
  const annotationsByPage = useMemo(() => {
    const grouped = new Map<number, Annotation[]>();
    for (const annotation of annotations) {
      const list = grouped.get(annotation.page) ?? [];
      list.push(annotation);
      grouped.set(annotation.page, list);
    }
    return grouped;
  }, [annotations]);

  const captureCurrentPageAnchor = useCallback(
    (targetZoom: number) => {
      const readerSurface = readerSurfaceRef.current;
      const pageElement = pageRefs.current[currentPage - 1];
      if (!readerSurface || !pageElement) {
        return;
      }

      const alignedTop = getPageAlignedScrollTop(pageElement, activeTopInset);
      const basePageHeight = pageBaseSizesRef.current.get(currentPage)?.height ??
        pageElement.offsetHeight / Math.max(0.01, zoom / 100);
      pendingZoomAnchorRef.current = {
        page: currentPage,
        pageOffsetRatio: Math.max(0, readerSurface.scrollTop - alignedTop) / Math.max(1, pageElement.offsetHeight),
        expectedPageHeight: basePageHeight * (targetZoom / 100),
        targetZoom,
      };
    },
    [activeTopInset, currentPage, zoom],
  );

  const changeReadingMode = useCallback(
    (enabled: boolean) => {
      if (enabled === isReadingMode) {
        return;
      }

      readingRestoreSequenceRef.current += 1;
      fitRequestSequenceRef.current += 1;
      pendingVisibleAlignmentRef.current = null;
      captureCurrentPageAnchor(zoomRef.current);
      const anchor = pendingZoomAnchorRef.current;
      readingModeTransitionAnchorRef.current = anchor
        ? { page: anchor.page, pageOffsetRatio: anchor.pageOffsetRatio }
        : null;

      if (enabled) {
        window.getSelection()?.removeAllRanges();
        setPendingSelection(null);
      }

      setIsReadingMode(enabled);
      setViewAlignmentRevision((revision) => revision + 1);
    },
    [captureCurrentPageAnchor, isReadingMode],
  );

  const cancelInitialReadingRestore = useCallback(() => {
    readingRestoreSequenceRef.current += 1;
  }, []);

  const cancelReaderAutoAlignment = useCallback(() => {
    readingRestoreSequenceRef.current += 1;
    fitRequestSequenceRef.current += 1;
    pendingVisibleAlignmentRef.current = null;
    pendingZoomAnchorRef.current = null;
    readingModeTransitionAnchorRef.current = null;
    activePageLockRef.current = null;
  }, []);

  // Ao entrar no layout compacto, libera a largura de leitura. O usuario ainda
  // pode reabrir o painel pelo cartao do documento, quando ele passa a atuar
  // como overlay sem deslocar a pagina.
  useEffect(() => {
    if (isCompactReader) {
      setLeftPanelOpen(false);
    }
  }, [isCompactReader]);

  useEffect(() => {
    let isCancelled = false;

    void getSetting(readerViewPreferencesSettingKey)
      .then((value) => {
        if (isCancelled) {
          return;
        }

        const preferences = parseReaderViewPreferences(value);
        setPageLayout(preferences.pageLayout);
        setContinuousScroll(preferences.continuousScroll);
        setShowCover(preferences.showCover);
        setViewPreferencesLoaded(true);
      })
      .catch((error) => {
        console.warn("Nao foi possivel carregar as preferencias de visualizacao do leitor.", error);
        if (!isCancelled) {
          setViewPreferencesLoaded(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!viewPreferencesLoaded) {
      return;
    }

    const preferences: ReaderViewPreferences = { pageLayout, continuousScroll, showCover };
    void setSetting(readerViewPreferencesSettingKey, JSON.stringify(preferences)).catch((error) => {
      console.warn("Nao foi possivel salvar as preferencias de visualizacao do leitor.", error);
    });
  }, [continuousScroll, pageLayout, showCover, viewPreferencesLoaded]);

  useEffect(() => {
    visibleContentAbortControllerRef.current.abort();
    visibleContentAbortControllerRef.current = new AbortController();
    visibleContentCacheRef.current = new Map();
    visibleContentGenerationRef.current += 1;
    pageBaseSizesRef.current.clear();
    pendingVisibleAlignmentRef.current = null;
    fitRequestSequenceRef.current += 1;
  }, [document.id, pdfDocument]);

  useLayoutEffect(() => {
    fitRequestSequenceRef.current += 1;
    pendingVisibleAlignmentRef.current = null;
  }, [currentPage, pageLayout, showCover]);

  useEffect(() => {
    for (const island of [leftIslandRef.current, dockIslandRef.current]) {
      island?.toggleAttribute("inert", isReadingMode);
    }

    if (isReadingMode) {
      if (sidePanelFloating) {
        minimizePanel(annotationsPanelId);
      }
      window.requestAnimationFrame(() => readingModeExitButtonRef.current?.focus({ preventScroll: true }));
    }
  }, [annotationsPanelId, isReadingMode, minimizePanel, sidePanelFloating]);

  useEffect(() => {
    return () => {
      visibleContentAbortControllerRef.current.abort();
      if (pinchZoomResetTimerRef.current !== null) {
        window.clearTimeout(pinchZoomResetTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setPageSizes(new Map());
  }, [document.id, zoom]);

  useEffect(() => {
    setReaderActionError("");
    setIsTogglingFavoriteFromContextMenu(false);
    setIsOpeningOriginalFromContextMenu(false);
  }, [document.id]);

  useEffect(() => {
    if (!readerActionError) {
      return;
    }

    const timeoutId = window.setTimeout(() => setReaderActionError(""), 6000);
    return () => window.clearTimeout(timeoutId);
  }, [readerActionError]);

  useLayoutEffect(() => {
    const readerSurface = readerSurfaceRef.current;

    if (!readerSurface) {
      return;
    }

    const visibleAlignment = pendingVisibleAlignmentRef.current;
    if (visibleAlignment && Math.abs(visibleAlignment.targetZoom - zoom) < 0.5) {
      const sizesAreReady = !pdfDocument || visibleAlignment.pageNumbers.every((pageNumber) => {
        const measured = pageSizes.get(pageNumber);
        const expected = visibleAlignment.expectedSizes.get(pageNumber);
        return Boolean(
          measured &&
          expected &&
          Math.abs(measured.width - expected.width) <= 3 &&
          Math.abs(measured.height - expected.height) <= 3,
        );
      });

      if (sizesAreReady) {
        const alignVisibleContent = () => {
          if (
            pendingVisibleAlignmentRef.current !== visibleAlignment ||
            visibleAlignment.requestId !== fitRequestSequenceRef.current ||
            Math.abs(visibleAlignment.targetZoom - zoomRef.current) >= 0.5
          ) {
            return;
          }

          const surfaceRect = readerSurface.getBoundingClientRect();
          let contentLeft = Number.POSITIVE_INFINITY;
          let contentTop = Number.POSITIVE_INFINITY;
          let contentRight = Number.NEGATIVE_INFINITY;
          let contentBottom = Number.NEGATIVE_INFINITY;

          for (const pageNumber of visibleAlignment.pageNumbers) {
            const pageElement = pageRefs.current[pageNumber - 1];
            if (!pageElement) {
              continue;
            }

            const pageRect = pageElement.getBoundingClientRect();
            const bounds = visibleAlignment.boundsByPage.get(pageNumber) ?? fullPageContentBounds;
            const pageLeft = pageRect.left - surfaceRect.left + readerSurface.scrollLeft;
            const pageTop = pageRect.top - surfaceRect.top + readerSurface.scrollTop;
            contentLeft = Math.min(contentLeft, pageLeft + pageRect.width * bounds.left);
            contentTop = Math.min(contentTop, pageTop + pageRect.height * bounds.top);
            contentRight = Math.max(contentRight, pageLeft + pageRect.width * bounds.right);
            contentBottom = Math.max(contentBottom, pageTop + pageRect.height * bounds.bottom);
          }

          if (![contentLeft, contentTop, contentRight, contentBottom].every(Number.isFinite)) {
            return;
          }

          const availableWidth = Math.max(1, readerSurface.clientWidth - readingLeftInset - readingRightInset);
          const availableHeight = Math.max(1, readerSurface.clientHeight - activeTopInset - activeBottomInset);
          const contentWidth = contentRight - contentLeft;
          const contentHeight = contentBottom - contentTop;
          const targetLeft = contentWidth <= availableWidth
            ? (contentLeft + contentRight) / 2 - (readingLeftInset + availableWidth / 2)
            : contentLeft - readingLeftInset;
          const targetTop = contentHeight <= availableHeight
            ? (contentTop + contentBottom) / 2 - (activeTopInset + availableHeight / 2)
            : contentTop - activeTopInset;
          const maxLeft = Math.max(0, readerSurface.scrollWidth - readerSurface.clientWidth);
          const maxTop = Math.max(0, readerSurface.scrollHeight - readerSurface.clientHeight);
          activePageLockRef.current = {
            page: visibleAlignment.activePage,
            expiresAt: window.performance.now() + 160,
          };
          readerSurface.scrollLeft = clamp(targetLeft, 0, maxLeft);
          readerSurface.scrollTop = clamp(targetTop, 0, maxTop);
          pendingVisibleAlignmentRef.current = null;
        };

        const frameId = window.requestAnimationFrame(alignVisibleContent);
        return () => window.cancelAnimationFrame(frameId);
      }
    }

    const zoomAnchor = pendingZoomAnchorRef.current;
    if (zoomAnchor && Math.abs(zoomAnchor.targetZoom - zoom) < 0.5) {
      const pageElement = pageRefs.current[zoomAnchor.page - 1];
      if (pageElement && (!pdfDocument || Math.abs(pageElement.offsetHeight - zoomAnchor.expectedPageHeight) <= 3)) {
        const frameId = window.requestAnimationFrame(() => {
          if (
            pendingZoomAnchorRef.current !== zoomAnchor ||
            Math.abs(zoomAnchor.targetZoom - zoomRef.current) >= 0.5
          ) {
            return;
          }
          activePageLockRef.current = {
            page: zoomAnchor.page,
            expiresAt: window.performance.now() + 160,
          };
          readerSurface.scrollTop = getPageAlignedScrollTop(pageElement, activeTopInset) +
            zoomAnchor.pageOffsetRatio * pageElement.offsetHeight;
          centerHorizontalScroll(readerSurface);
          pendingZoomAnchorRef.current = null;
        });
        return () => window.cancelAnimationFrame(frameId);
      }
    }

    const frameId = window.requestAnimationFrame(() => centerHorizontalScroll(readerSurface));
    return () => window.cancelAnimationFrame(frameId);
  }, [
    activeBottomInset,
    activeTopInset,
    currentPage,
    isReadingMode,
    leftPanelOpen,
    pageLayout,
    pageSizes,
    pdfDocument,
    readerPanelSize.width,
    readingLeftInset,
    readingRightInset,
    showCover,
    viewAlignmentRevision,
    zoom,
  ]);

  const updatePageSize = useCallback((pageNumber: number, size: PageSize, renderedZoom: number) => {
    pageBaseSizesRef.current.set(pageNumber, {
      width: size.width / Math.max(0.01, renderedZoom / 100),
      height: size.height / Math.max(0.01, renderedZoom / 100),
    });

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
  const { flushReadingTime } = useReadingTimer(document.id, document.timeSpentSeconds);

  const flushNotes = useCallback(async () => {
    if (notesSaveTimerRef.current !== null) {
      window.clearTimeout(notesSaveTimerRef.current);
      notesSaveTimerRef.current = null;
    }

    await onSaveNotes(document.id, latestNotesRef.current);
  }, [document.id, onSaveNotes]);

  useEffect(() => {
    return () => {
      if (notesSaveTimerRef.current !== null) {
        window.clearTimeout(notesSaveTimerRef.current);
        notesSaveTimerRef.current = null;
        void onSaveNotes(document.id, latestNotesRef.current);
      }
    };
  }, [document.id, onSaveNotes]);

  useEffect(() => {
    if (!hasPdfSource(document)) {
      setPdfDocument(null);
      setPdfOutline([]);
      setPdfError("");
      setFileSizeBytes(null);
      setIsPdfLoading(false);
      setTotalPages(fallbackPageCount);
      return;
    }

    let isCancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;
    setIsPdfLoading(true);
    setPdfError("");
    setFileSizeBytes(null);

    async function resolvePdfSource() {
      if (document.fileUrl) {
        return { source: { url: document.fileUrl }, sizeBytes: null };
      }

      const base64 = await invoke<string>("read_pdf_file", { filePath: document.filePath });
      const bytes = base64ToBytes(base64);
      return { source: { data: bytes }, sizeBytes: bytes.byteLength };
    }

    resolvePdfSource()
      .then(async ({ source, sizeBytes }) => {
        if (isCancelled) {
          return;
        }

        setFileSizeBytes(sizeBytes);
        loadingTask = pdfjsLib.getDocument(source);
        const loadedDocument = await loadingTask.promise;

        if (isCancelled) {
          return;
        }

        setPdfDocument(loadedDocument);
        setTotalPages(loadedDocument.numPages);
        setCurrentPage((page) => clamp(page, 1, loadedDocument.numPages));

        const outlineItems = await resolveOutlineWithPages(loadedDocument);
        if (!isCancelled) {
          setPdfOutline(outlineItems);
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

  const loadDocumentAnnotations = useCallback(() => listAnnotations(document.id), [document.id]);

  // Carrega as anotacoes salvas ao abrir/trocar de documento.
  useEffect(() => {
    let isCancelled = false;
    const requestSequence = ++annotationsReloadSequenceRef.current;
    const emptySaveStates = new Map<string, AnnotationSaveState>();
    setAnnotations([]);
    saveStatesRef.current = emptySaveStates;
    setSaveStates(emptySaveStates);
    failedCreatesRef.current = new Map();

    loadDocumentAnnotations()
      .then((loaded) => {
        if (!isCancelled && requestSequence === annotationsReloadSequenceRef.current) {
          setAnnotations(loaded);
        }
      })
      .catch((error) => {
        console.warn("Nao foi possivel carregar as anotacoes.", error);
      });

    return () => {
      isCancelled = true;
    };
  }, [document.id, loadDocumentAnnotations]);

  const setSaveState = useCallback((annotationId: string, state: AnnotationSaveState) => {
    const next = new Map(saveStatesRef.current);
    next.set(annotationId, state);
    saveStatesRef.current = next;
    setSaveStates(next);
  }, []);

  const clearSaveState = useCallback((annotationId: string) => {
    if (!saveStatesRef.current.has(annotationId)) {
      return;
    }

    const next = new Map(saveStatesRef.current);
    next.delete(annotationId);
    saveStatesRef.current = next;
    setSaveStates(next);
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
        setAnnotations((current) => [
          ...current.filter((item) => item.id !== optimisticId && item.id !== saved.id),
          saved,
        ]);
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

  function buildPayload(
    page: number,
    text: string,
    rects: NewAnnotation["rects"],
    color: HighlightColor,
    note = "",
  ): NewAnnotation {
    return { documentId: document.id, page, color, selectedText: text, note, rects };
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

  const createNoteFromSelection = useCallback((note: string) => {
    const normalizedNote = note.trim();

    if (!pendingSelection || !normalizedNote) {
      return;
    }

    for (const pageRects of pendingSelection.pages) {
      addAnnotationFromPayload(
        buildPayload(pageRects.page, pendingSelection.text, pageRects.rects, "amber", normalizedNote),
      );
    }

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
    cancelReaderAutoAlignment();
    const readerSurface = readerSurfaceRef.current;
    const targetPage = clamp(Math.round(page), 1, totalPages);
    const pageElement = pageRefs.current[targetPage - 1];
    activePageLockRef.current = {
      page: targetPage,
      expiresAt: window.performance.now() + 700,
    };

    if (!readerSurface || !pageElement) {
      setCurrentPage(targetPage);
      return;
    }

    setCurrentPage(targetPage);
    readerSurface.scrollTo({
      top: getPageAlignedScrollTop(pageElement, activeTopInset),
      behavior: "smooth",
    });
  }, [activeTopInset, cancelReaderAutoAlignment, totalPages]);

  useEffect(() => {
    let isDisposed = false;
    const unlistenCallbacks: Array<() => void> = [];
    const currentWindowLabel = getCurrentWebviewWindow().label;

    function registerListener<T>(eventName: string, handler: (payload: T) => void) {
      void listen<T>(eventName, (event) => handler(event.payload))
        .then((unlisten) => {
          if (isDisposed) {
            unlisten();
            return;
          }

          unlistenCallbacks.push(unlisten);
        })
        .catch((error) => {
          console.warn(`Nao foi possivel escutar o evento ${eventName}.`, error);
        });
    }

    registerListener<unknown>(READER_NOTES_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== document.id ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      const requestSequence = ++notesReloadSequenceRef.current;
      void getDocumentNotes(document.id)
        .then((loadedNotes) => {
          if (isDisposed || requestSequence !== notesReloadSequenceRef.current) {
            return;
          }

          setNotesText(loadedNotes);
          latestNotesRef.current = loadedNotes;
          onNotesReloaded(document.id, loadedNotes);
        })
        .catch((error) => {
          console.warn("Nao foi possivel recarregar as notas do Reader.", error);
        });
    });

    registerListener<unknown>(READER_ANNOTATIONS_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== document.id ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      const requestSequence = ++annotationsReloadSequenceRef.current;
      void loadDocumentAnnotations()
        .then((loadedAnnotations) => {
          if (isDisposed || requestSequence !== annotationsReloadSequenceRef.current) {
            return;
          }

          setAnnotations((current) =>
            mergeAnnotationsPreservingPending(loadedAnnotations, current, saveStatesRef.current),
          );
        })
        .catch((error) => {
          console.warn("Nao foi possivel recarregar as anotacoes do Reader.", error);
        });
    });

    registerListener<unknown>(READER_DETAILS_CHANGED_EVENT, (payload) => {
      if (
        !isReaderInvalidationPayload(payload) ||
        payload.documentId !== document.id ||
        payload.origin === currentWindowLabel
      ) {
        return;
      }

      void queryClient.invalidateQueries({ queryKey: ["library"] });
    });

    registerListener<unknown>(READER_JUMP_TO_PAGE_EVENT, (payload) => {
      if (!isReaderJumpToPagePayload(payload) || payload.documentId !== document.id) {
        return;
      }

      scrollToPage(payload.page);
    });

    registerListener<unknown>(READER_OPEN_NOTEBOOK_EVENT, (payload) => {
      if (!isReaderOpenNotebookPayload(payload) || payload.documentId !== document.id) {
        return;
      }

      const width = Math.min(notebookPanelWidth, window.innerWidth);
      const height = Math.min(notebookPanelHeight, window.innerHeight);
      openPanel("notebook", String(payload.notebookId), getCenteredPanelPosition(width, height));
    });

    registerListener<unknown>(READER_PAGE_STATE_REQUESTED_EVENT, (payload) => {
      if (!isReaderDocumentPayload(payload) || payload.documentId !== document.id) {
        return;
      }

      void emitTo(
        READER_PANEL_WINDOW_LABEL,
        READER_PAGE_STATE_CHANGED_EVENT,
        currentPageStateRef.current,
      ).catch((error) => {
        console.warn("Nao foi possivel responder a sincronizacao da popout.", error);
      });
    });

    registerListener<unknown>(READER_POPOUT_CLOSED_EVENT, (payload) => {
      if (!isReaderDocumentPayload(payload) || payload.documentId !== document.id) {
        return;
      }

      updatePopoutDocumentId(null);
    });

    return () => {
      isDisposed = true;
      unlistenCallbacks.splice(0).forEach((unlisten) => unlisten());
    };
  }, [document.id, loadDocumentAnnotations, onNotesReloaded, openPanel, queryClient, scrollToPage, updatePopoutDocumentId]);

  const closePopoutAfterFlush = useCallback(async (): Promise<boolean> => {
    if (popoutDocumentIdRef.current !== document.id) {
      return true;
    }

    if (closePopoutPromiseRef.current) {
      return closePopoutPromiseRef.current;
    }

    const closePromise = (async () => {
      const requestId = crypto.randomUUID();
      const payload: ReaderPopoutCloseRequestPayload = { documentId: document.id, requestId };
      let timeoutId: number | null = null;
      const listenerRegistration: { unlisten: (() => void) | null } = { unlisten: null };
      let isFinished = false;

      try {
        const flushed = new Promise<void>((resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            reject(new Error("A popout nao confirmou o flush dentro do prazo."));
          }, popoutFlushTimeoutMs);

          void listen<unknown>(READER_POPOUT_FLUSHED_EVENT, (event) => {
            if (
              isReaderPopoutCloseRequestPayload(event.payload) &&
              event.payload.documentId === document.id &&
              event.payload.requestId === requestId
            ) {
              resolve();
            }
            })
            .then((removeListener) => {
              if (isFinished) {
                removeListener();
                return;
              }

              listenerRegistration.unlisten = removeListener;
              return emitTo(READER_PANEL_WINDOW_LABEL, READER_REQUEST_POPOUT_CLOSE_EVENT, payload);
            })
            .catch(reject);
        });

        await flushed;
        await invoke("close_reader_panel_window");
        updatePopoutDocumentId(null);
        return true;
      } catch (error) {
        console.warn("Nao foi possivel fechar a popout depois do flush.", error);
        return false;
      } finally {
        isFinished = true;
        if (timeoutId !== null) {
          window.clearTimeout(timeoutId);
        }
        listenerRegistration.unlisten?.();
      }
    })();

    closePopoutPromiseRef.current = closePromise;
    try {
      return await closePromise;
    } finally {
      if (closePopoutPromiseRef.current === closePromise) {
        closePopoutPromiseRef.current = null;
      }
    }
  }, [document.id, updatePopoutDocumentId]);

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
      pageOffset: pageElement ? Math.max(0, scrollTop - getPageAlignedScrollTop(pageElement, activeTopInset)) : 0,
      zoom,
      savedAt: new Date().toISOString(),
    };
  }, [activeTopInset, currentPage, document.readingLocation?.pageOffset, document.readingLocation?.scrollRatio, totalPages, zoom]);

  const applyNativeFullscreenVisualState = useCallback(
    (fullscreen: boolean) => {
      if (fullscreen === isNativeFullscreenRef.current) {
        return;
      }

      if (fullscreen) {
        if (!isReaderMaximized && readerPanel) {
          nativeFullscreenRestoreStateRef.current = {
            position: readerPanel.position,
            size: readerPanelSize,
          };
        }
        isNativeFullscreenRef.current = true;
        setIsNativeFullscreen(true);
        setReaderPanelSize(getMaximizedReaderSize());
        movePanel(readerPanelId, { x: 0, y: 0 });
        return;
      }

      isNativeFullscreenRef.current = false;
      setIsNativeFullscreen(false);

      if (isReaderMaximized) {
        setReaderPanelSize(getMaximizedReaderSize());
        movePanel(readerPanelId, { x: 0, y: 0 });
        nativeFullscreenRestoreStateRef.current = null;
        return;
      }

      const fallbackSize = getDefaultReaderSize();
      const restoreState = nativeFullscreenRestoreStateRef.current ?? {
        size: fallbackSize,
        position: getDefaultReaderPosition(fallbackSize),
      };
      const restoredSize = clampReaderSizeToViewport(restoreState.size);
      setReaderPanelSize(restoredSize);
      movePanel(readerPanelId, clampReaderPositionToViewport(restoreState.position, restoredSize));
      nativeFullscreenRestoreStateRef.current = null;
    },
    [isReaderMaximized, movePanel, readerPanel, readerPanelId, readerPanelSize],
  );

  useLayoutEffect(() => {
    if (!readerNativeFullscreenSessionActive || isNativeFullscreenRef.current) {
      return;
    }

    nativeFullscreenOwnedRef.current = true;
    applyNativeFullscreenVisualState(true);
  }, [applyNativeFullscreenVisualState]);

  const setNativeFullscreen = useCallback(
    async (fullscreen: boolean) => {
      // Fila global: ao trocar de PDF, mais de uma instancia pode receber Esc
      // enquanto a mesma entrada em tela cheia termina. O loop revalida a
      // fila depois de cada await, impedindo duas saidas concorrentes.
      while (readerNativeFullscreenTransitionPromise) {
        await readerNativeFullscreenTransitionPromise;
      }

      if (fullscreen === (isNativeFullscreenRef.current || readerNativeFullscreenSessionActive)) {
        return;
      }

      const operation = (async () => {
        fullscreenSyncSequenceRef.current += 1;
        fullscreenTransitioningRef.current = true;
        setIsFullscreenTransitioning(true);
        setReaderActionError("");

        try {
          await getCurrentWebviewWindow().setFullscreen(fullscreen);
          readerNativeFullscreenSessionActive = fullscreen;
          nativeFullscreenOwnedRef.current = fullscreen;
          applyNativeFullscreenVisualState(fullscreen);
        } catch (error) {
          console.warn("Nao foi possivel alterar a tela cheia nativa.", error);
          setReaderActionError("Não foi possível alterar o modo de tela cheia.");
        } finally {
          fullscreenTransitioningRef.current = false;
          setIsFullscreenTransitioning(false);
        }
      })();

      let transition: Promise<void>;
      transition = operation.finally(() => {
        if (fullscreenTransitionPromiseRef.current === transition) {
          fullscreenTransitionPromiseRef.current = null;
        }
        if (readerNativeFullscreenTransitionPromise === transition) {
          readerNativeFullscreenTransitionPromise = null;
        }
      });
      fullscreenTransitionPromiseRef.current = transition;
      readerNativeFullscreenTransitionPromise = transition;
      await transition;
    },
    [applyNativeFullscreenVisualState],
  );

  const toggleNativeFullscreen = useCallback(() => {
    return setNativeFullscreen(!(isNativeFullscreenRef.current || readerNativeFullscreenSessionActive));
  }, [setNativeFullscreen]);

  const exitOwnedNativeFullscreen = useCallback(async () => {
    while (readerNativeFullscreenTransitionPromise) {
      await readerNativeFullscreenTransitionPromise;
    }

    if (!nativeFullscreenOwnedRef.current && !readerNativeFullscreenSessionActive) {
      return;
    }

    if (!isNativeFullscreenRef.current) {
      const fullscreen = await getCurrentWebviewWindow().isFullscreen();
      if (!fullscreen) {
        nativeFullscreenOwnedRef.current = false;
        readerNativeFullscreenSessionActive = false;
        return;
      }
      nativeFullscreenOwnedRef.current = true;
      applyNativeFullscreenVisualState(true);
    }

    await setNativeFullscreen(false);
  }, [applyNativeFullscreenVisualState, setNativeFullscreen]);

  useEffect(() => {
    let isDisposed = false;
    let removeResizeListener: (() => void) | null = null;
    const appWindow = getCurrentWebviewWindow();

    async function synchronizeFullscreenState() {
      try {
        while (readerNativeFullscreenTransitionPromise) {
          await readerNativeFullscreenTransitionPromise;
          if (isDisposed) {
            return;
          }
        }

        const requestSequence = ++fullscreenSyncSequenceRef.current;
        const fullscreen = await appWindow.isFullscreen();
        if (
          isDisposed ||
          fullscreenTransitioningRef.current ||
          readerNativeFullscreenTransitionPromise ||
          requestSequence !== fullscreenSyncSequenceRef.current
        ) {
          return;
        }

        if (!fullscreen) {
          nativeFullscreenOwnedRef.current = false;
          readerNativeFullscreenSessionActive = false;
        } else if (readerNativeFullscreenSessionActive) {
          nativeFullscreenOwnedRef.current = true;
        }
        applyNativeFullscreenVisualState(fullscreen);
      } catch (error) {
        console.warn("Nao foi possivel sincronizar o estado de tela cheia.", error);
      }
    }

    void synchronizeFullscreenState();
    void appWindow
      .onResized(() => {
        void synchronizeFullscreenState();
      })
      .then((unlisten) => {
        if (isDisposed) {
          unlisten();
          return;
        }
        removeResizeListener = unlisten;
      })
      .catch((error) => {
        console.warn("Nao foi possivel observar a janela para sincronizar a tela cheia.", error);
      });

    return () => {
      isDisposed = true;
      removeResizeListener?.();
    };
  }, [applyNativeFullscreenVisualState]);

  useEffect(() => {
    const instanceToken = readerInstanceTokenRef.current;

    return () => {
      const pendingTransition = fullscreenTransitionPromiseRef.current ?? readerNativeFullscreenTransitionPromise;
      if (pendingTransition || nativeFullscreenOwnedRef.current || readerNativeFullscreenSessionActive) {
        nativeFullscreenOwnedRef.current = false;
        void Promise.resolve(pendingTransition)
          .catch(() => undefined)
          .then(() => {
            // Uma nova instancia assumiu a janela durante a troca de PDF. Ela
            // herda a sessao; o cleanup antigo nao pode desfazer sua tela cheia.
            if (activeReaderInstanceToken && activeReaderInstanceToken !== instanceToken) {
              return;
            }

            return getCurrentWebviewWindow().setFullscreen(false).then(() => {
              readerNativeFullscreenSessionActive = false;
            });
          })
          .catch((error) => {
            console.warn("Nao foi possivel sair da tela cheia ao desmontar o leitor.", error);
          });
      }
    };
  }, []);

  // Marca o fechamento explicito para o flush de unmount (abaixo) nao rodar
  // em duplicidade depois do closeAndSave.
  const hasClosedExplicitlyRef = useRef(false);

  const closeAndSave = useCallback(async () => {
    hasClosedExplicitlyRef.current = true;
    const readingLocation = getCurrentReadingLocation();

    try {
      await flushNotes();
    } catch (error) {
      hasClosedExplicitlyRef.current = false;
      console.warn("Nao foi possivel salvar as notas antes de fechar o leitor.", error);
      return;
    }

    await flushReadingTime().catch((error) => {
      console.warn("Nao foi possivel salvar o tempo de leitura antes de fechar.", error);
    });

    if (!(await closePopoutAfterFlush())) {
      hasClosedExplicitlyRef.current = false;
      return;
    }

    await exitOwnedNativeFullscreen();
    onClose(readingLocation);
  }, [closePopoutAfterFlush, exitOwnedNativeFullscreen, flushNotes, flushReadingTime, getCurrentReadingLocation, onClose]);

  // Ctrl+F abre a sidebar esquerda e foca o campo de busca do documento.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        if (isReadingMode) {
          changeReadingMode(false);
        } else {
          cancelReaderAutoAlignment();
          captureCurrentPageAnchor(zoomRef.current);
          setViewAlignmentRevision((revision) => revision + 1);
        }
        setLeftPanelOpen(true);
        setSearchFocusSignal((signal) => signal + 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelReaderAutoAlignment, captureCurrentPageAnchor, changeReadingMode, isReadingMode]);

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
    void (async () => {
      try {
        await flushNotes();
        await closePopoutAfterFlush();
      } catch (error) {
        console.warn("Nao foi possivel concluir o fechamento coordenado da popout.", error);
      }
    })();
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

    const restoreSequence = ++readingRestoreSequenceRef.current;
    const restorePosition = () => {
      if (restoreSequence !== readingRestoreSequenceRef.current) {
        return;
      }

      const pageElement = pageRefs.current[Math.max(0, Math.min(totalPages - 1, location.page - 1))];
      const scrollMax = Math.max(0, readerSurface.scrollHeight - readerSurface.clientHeight);
      const targetTop = pageElement
        ? getPageAlignedScrollTop(pageElement, activeTopInset) + (location.pageOffset ?? 0)
        : location.scrollRatio * scrollMax;
      readerSurface.scrollTop = Math.min(scrollMax, Math.max(0, targetTop));
    };

    const frameId = window.requestAnimationFrame(restorePosition);
    const restoreTimer = window.setTimeout(restorePosition, 500);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(restoreTimer);
      if (readingRestoreSequenceRef.current === restoreSequence) {
        readingRestoreSequenceRef.current += 1;
      }
    };
  }, [document.id, document.readingLocation, isPdfLoading, pdfDocument, totalPages]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented || event.repeat) {
        return;
      }

      if (readerContextMenu.isOpen) {
        closeReaderContextMenu();
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

      // Esc primeiro fecha a toolbar de selecao, depois o modo de leitura e
      // por ultimo a tela cheia. Assim o atalho acompanha a camada visivel
      // mais proxima do usuario e nunca fecha o Reader por baixo dela.
      if (pendingSelection) {
        event.preventDefault();
        window.getSelection()?.removeAllRanges();
        setPendingSelection(null);
        return;
      }

      if (isReadingMode) {
        event.preventDefault();
        changeReadingMode(false);
        window.requestAnimationFrame(() => readerSurfaceRef.current?.focus({ preventScroll: true }));
        return;
      }

      if (
        fullscreenTransitioningRef.current ||
        readerNativeFullscreenTransitionPromise ||
        isNativeFullscreenRef.current ||
        readerNativeFullscreenSessionActive
      ) {
        event.preventDefault();
        void setNativeFullscreen(false);
        return;
      }

      void closeAndSave();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [changeReadingMode, closeAndSave, editingAnnotationId, pendingSelection, floatingPanels, isReadingMode, readerContextMenu.isOpen, readerPanelId, setNativeFullscreen]);

  useEffect(() => {
    function handleFullscreenShortcut(event: KeyboardEvent) {
      if (
        event.key !== "F11" ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.defaultPrevented ||
        event.repeat
      ) {
        return;
      }

      const topPanel = [...floatingPanels].reverse().find((panel) => !panel.isMinimized);
      if (topPanel && topPanel.id !== readerPanelId) {
        return;
      }

      event.preventDefault();
      if (fullscreenTransitioningRef.current || readerNativeFullscreenTransitionPromise) {
        return;
      }
      void toggleNativeFullscreen();
    }

    window.addEventListener("keydown", handleFullscreenShortcut);
    return () => window.removeEventListener("keydown", handleFullscreenShortcut);
  }, [floatingPanels, readerPanelId, toggleNativeFullscreen]);

  function handleReaderScroll() {
    // A toolbar e posicionada por coordenadas de viewport; ao rolar ela ficaria
    // deslocada, entao escondemos a selecao pendente.
    if (pendingSelection) {
      window.getSelection()?.removeAllRanges();
      setPendingSelection(null);
    }

    const readerSurface = readerSurfaceRef.current;

    if (!readerSurface) {
      return;
    }

    const activePageLock = activePageLockRef.current;
    if (activePageLock && window.performance.now() < activePageLock.expiresAt) {
      setCurrentPage(activePageLock.page);
      scheduleReadingSave();
      return;
    }
    activePageLockRef.current = null;

    const anchor = readerSurface.scrollTop + activeTopInset + 34;
    let activePages = [1];
    let activePageTop = Number.NEGATIVE_INFINITY;
    pageRefs.current.forEach((pageElement, index) => {
      if (!pageElement || pageElement.offsetTop > anchor) {
        return;
      }

      if (pageElement.offsetTop > activePageTop) {
        activePages = [index + 1];
        activePageTop = pageElement.offsetTop;
      } else if (pageElement.offsetTop === activePageTop) {
        activePages.push(index + 1);
      }
    });
    const activePage = activePages.includes(currentPage) ? currentPage : activePages[0] ?? 1;
    setCurrentPage(activePage);
    scheduleReadingSave();
  }

  const applyZoom = useCallback(
    (nextZoom: number, mode: ReaderZoomMode) => {
      cancelInitialReadingRestore();
      const targetZoom = clamp(nextZoom, minZoom, maxZoom);
      captureCurrentPageAnchor(targetZoom);

      if (mode !== "visible") {
        pendingVisibleAlignmentRef.current = null;
      }
      if (mode === "custom") {
        fitRequestSequenceRef.current += 1;
      }

      zoomRef.current = targetZoom;
      setZoomMode(mode);
      setZoom(targetZoom);
      scheduleReadingSave();
    },
    [cancelInitialReadingRestore, captureCurrentPageAnchor, scheduleReadingSave],
  );

  const changeZoom = useCallback((nextZoom: number) => {
    cancelReaderAutoAlignment();
    applyZoom(nextZoom, "custom");
  }, [applyZoom, cancelReaderAutoAlignment]);

  const changeZoomBy = useCallback(
    (delta: number) => {
      cancelReaderAutoAlignment();
      applyZoom(zoomRef.current + delta, "custom");
    },
    [applyZoom, cancelReaderAutoAlignment],
  );

  // Mantem os atalhos no zoom do documento e bloqueia o zoom nativo do
  // WebView, que escalaria toda a interface e desalinharia o PDF da text layer.
  useEffect(() => {
    function handleZoomShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.defaultPrevented) {
        return;
      }

      const topPanel = [...floatingPanels].reverse().find((panel) => !panel.isMinimized);
      if (topPanel && topPanel.id !== readerPanelId) {
        return;
      }

      const isZoomIn = event.key === "+" || event.key === "=" || event.code === "NumpadAdd";
      const isZoomOut = event.key === "-" || event.key === "_" || event.code === "NumpadSubtract";
      const isReset = event.key === "0" || event.code === "Numpad0";

      if (!isZoomIn && !isZoomOut && !isReset) {
        return;
      }

      event.preventDefault();

      if (isReset) {
        changeZoom(100);
      } else {
        changeZoomBy(isZoomIn ? zoomStep : -zoomStep);
      }
    }

    window.addEventListener("keydown", handleZoomShortcut);
    return () => window.removeEventListener("keydown", handleZoomShortcut);
  }, [changeZoom, changeZoomBy, floatingPanels, readerPanelId]);

  // Chromium/WebView2 representa a pinca do touchpad como wheel + ctrlKey. O
  // listener precisa ser nao-passivo para impedir o zoom nativo da janela.
  useEffect(() => {
    const readerSurface = readerSurfaceRef.current;

    if (!readerSurface) {
      return;
    }

    function handlePinchZoom(event: WheelEvent) {
      if (!event.ctrlKey || event.altKey) {
        return;
      }

      event.preventDefault();
      if (pinchZoomResetTimerRef.current !== null) {
        window.clearTimeout(pinchZoomResetTimerRef.current);
      }
      pinchZoomResetTimerRef.current = window.setTimeout(() => {
        pinchZoomAccumulatorRef.current = 0;
        pinchZoomResetTimerRef.current = null;
      }, pinchZoomResetDelayMs);
      const eventSurfaceHeight = event.currentTarget instanceof HTMLElement ? event.currentTarget.clientHeight : 1;
      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? eventSurfaceHeight : 1;
      const normalizedDelta = event.deltaY * deltaMultiplier;
      const currentAccumulator = pinchZoomAccumulatorRef.current;

      if (currentAccumulator !== 0 && Math.sign(currentAccumulator) !== Math.sign(normalizedDelta)) {
        pinchZoomAccumulatorRef.current = 0;
      }

      pinchZoomAccumulatorRef.current += normalizedDelta;
      const accumulatedDelta = pinchZoomAccumulatorRef.current;
      const stepCount = Math.trunc(Math.abs(accumulatedDelta) / pinchZoomThreshold);

      if (stepCount === 0) {
        return;
      }

      const accumulatedDirection = Math.sign(accumulatedDelta);
      pinchZoomAccumulatorRef.current -= accumulatedDirection * stepCount * pinchZoomThreshold;
      changeZoomBy(accumulatedDirection < 0 ? stepCount * zoomStep : -stepCount * zoomStep);
    }

    readerSurface.addEventListener("wheel", handlePinchZoom, { passive: false });
    return () => readerSurface.removeEventListener("wheel", handlePinchZoom);
  }, [changeZoomBy, readerPanel?.id]);

  function closeReaderContextMenu() {
    const shouldRestoreFocus = readerContextMenuOpenedByKeyboardRef.current;
    readerContextMenuOpenedByKeyboardRef.current = false;
    readerContextMenu.close();

    if (shouldRestoreFocus) {
      window.requestAnimationFrame(() => readerSurfaceRef.current?.focus({ preventScroll: true }));
    }
  }

  function openReaderContextMenu(event: ReactMouseEvent<HTMLElement>) {
    readerContextMenuOpenedByKeyboardRef.current = false;
    readerContextMenu.open(event);
  }

  function handleReaderContextMenuKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)
    ) {
      cancelReaderAutoAlignment();
    }

    if (!((event.shiftKey && event.key === "F10") || event.key === "ContextMenu")) {
      return;
    }

    event.preventDefault();
    const surfaceRect = event.currentTarget.getBoundingClientRect();
    readerContextMenuOpenedByKeyboardRef.current = true;
    readerContextMenu.openAt(
      surfaceRect.left + Math.min(surfaceRect.width / 2, 520),
      surfaceRect.top + Math.min(112, surfaceRect.height / 3),
    );
  }

  async function handleContextToggleFavorite() {
    if (isTogglingFavoriteFromContextMenu) {
      return;
    }

    closeReaderContextMenu();
    setReaderActionError("");
    setIsTogglingFavoriteFromContextMenu(true);

    try {
      await onToggleFavorite(document.id);
    } catch (error) {
      console.warn("Nao foi possivel atualizar o favorito.", error);
      setReaderActionError("Não foi possível atualizar o favorito. Tente novamente.");
    } finally {
      setIsTogglingFavoriteFromContextMenu(false);
    }
  }

  async function handleContextOpenOriginal() {
    if (isOpeningOriginalFromContextMenu) {
      return;
    }

    closeReaderContextMenu();
    setReaderActionError("");
    setIsOpeningOriginalFromContextMenu(true);

    try {
      await openDocumentExternally(document.id);
    } catch (error) {
      console.warn("Nao foi possivel abrir o PDF externamente.", error);
      setReaderActionError("Não foi possível abrir o PDF original. Verifique o arquivo e tente novamente.");
    } finally {
      setIsOpeningOriginalFromContextMenu(false);
    }
  }

  // A doca 1C permanece no leitor. Esta acao oferece a mesma informacao em um
  // painel independente para fluxos que precisam de mais espaco; openPanel
  // tambem restaura e traz para frente uma instancia ja existente.
  function openDetachedPanel() {
    openPanel("annotations", document.id, getAnnotationsPanelInitialPosition());
  }

  // Leva o painel de detalhes/anotacoes para uma janela nativa do SO. Faz o
  // flush das notas e da posicao ANTES de abrir, para a popout ler do SQLite ja
  // com o estado atual.
  async function openPanelSystemWindow() {
    await flushNotes();
    await setDocumentReadingLocation(document, getCurrentReadingLocation());
    await invoke("open_reader_panel_window", {
      documentId: document.id,
      documentTitle: document.title,
    });
    updatePopoutDocumentId(document.id);
    const payload: ReaderPageStatePayload = {
      documentId: document.id,
      page: currentPage,
      progress,
      totalPages: pdfDocument?.numPages ?? null,
      fileSizeBytes,
    };
    await emitTo(READER_PANEL_WINDOW_LABEL, READER_PAGE_STATE_CHANGED_EVENT, payload);
  }

  const getVisibleContentBounds = useCallback(
    (pageNumber: number) => {
      const sourcePdfDocument = pdfDocument;
      if (sourcePdfDocument && sourcePdfDocument !== pdfDocumentRef.current) {
        return Promise.reject(new DOMException("Analise cancelada.", "AbortError"));
      }

      const cache = visibleContentCacheRef.current;
      const cached = cache.get(pageNumber);
      if (cached) {
        return cached;
      }

      const generation = visibleContentGenerationRef.current;
      const signal = visibleContentAbortControllerRef.current.signal;
      let request: Promise<NormalizedContentBounds>;
      request = (async () => {
        if (!sourcePdfDocument) {
          return fullPageContentBounds;
        }

        const page = await sourcePdfDocument.getPage(pageNumber);
        if (
          signal.aborted ||
          generation !== visibleContentGenerationRef.current ||
          sourcePdfDocument !== pdfDocumentRef.current
        ) {
          throw new DOMException("Analise cancelada.", "AbortError");
        }
        return analyzePdfPageVisibleContent(page, signal);
      })().catch((error) => {
        if (cache.get(pageNumber) === request) {
          cache.delete(pageNumber);
        }
        throw error;
      });

      cache.set(pageNumber, request);
      return request;
    },
    [pdfDocument],
  );

  const getFitPages = useCallback(
    async (mode: Exclude<ReaderZoomMode, "custom">): Promise<ReaderFitPage[]> => {
      const sourceDocumentId = document.id;
      const sourcePdfDocument = pdfDocument;
      const ensureCurrentDocument = () => {
        if (
          activeDocumentIdRef.current !== sourceDocumentId ||
          pdfDocumentRef.current !== sourcePdfDocument
        ) {
          throw new DOMException("Ajuste cancelado.", "AbortError");
        }
      };
      const group = currentPageGroup.length > 0 ? currentPageGroup : [currentPage];
      const pages = await Promise.all(
        group.map(async (pageNumber) => {
          let size = estimatedPageSize(100);

          if (sourcePdfDocument) {
            const page = await sourcePdfDocument.getPage(pageNumber);
            ensureCurrentDocument();
            const viewport = page.getViewport({ scale: pdfBaseScale });
            size = { width: viewport.width, height: viewport.height };
          }
          ensureCurrentDocument();
          pageBaseSizesRef.current.set(pageNumber, size);

          const bounds = mode === "visible" ? await getVisibleContentBounds(pageNumber) : undefined;
          ensureCurrentDocument();

          return {
            ...size,
            bounds,
          };
        }),
      );

      // No modo livro, a capa ocupa a folha direita. A folha vazia participa
      // dos ajustes integrais para preservar o eixo visual do spread.
      if (
        mode !== "visible" &&
        pageLayout === "spread" &&
        showCover &&
        group.length === 1 &&
        group[0] === 1
      ) {
        return [{ width: pages[0]?.width ?? estimatedPageSize(100).width, height: pages[0]?.height ?? estimatedPageSize(100).height }, ...pages];
      }

      return pages;
    },
    [currentPage, currentPageGroup, document.id, getVisibleContentBounds, pageLayout, pdfDocument, showCover],
  );

  const applyFitMode = useCallback(
    async (mode: Exclude<ReaderZoomMode, "custom">) => {
      cancelInitialReadingRestore();
      if (mode === "actual") {
        fitRequestSequenceRef.current += 1;
        pendingVisibleAlignmentRef.current = null;
        applyZoom(100, "actual");
        return;
      }

      const readerSurface = readerSurfaceRef.current;
      if (!readerSurface) {
        return;
      }

      const requestId = ++fitRequestSequenceRef.current;
      try {
        const pages = await getFitPages(mode);
        if (requestId !== fitRequestSequenceRef.current) {
          return;
        }

        const targetZoom = calculateReaderFitZoom({
          pages,
          availableWidth: readerSurface.clientWidth - readingLeftInset - readingRightInset,
          availableHeight: readerSurface.clientHeight - activeTopInset - activeBottomInset,
          mode,
          pageGap: readerPageGap,
          minZoom,
          maxZoom,
        });

        if (mode === "visible") {
          const boundsByPage = new Map<number, NormalizedContentBounds>();
          currentPageGroup.forEach((pageNumber, index) => {
            boundsByPage.set(pageNumber, pages[index]?.bounds ?? fullPageContentBounds);
          });
          pendingVisibleAlignmentRef.current = {
            requestId,
            activePage: currentPage,
            pageNumbers: [...currentPageGroup],
            boundsByPage,
            expectedSizes: new Map(
              currentPageGroup.map((pageNumber, index) => [
                pageNumber,
                {
                  width: (pages[index]?.width ?? estimatedPageSize(100).width) * (targetZoom / 100),
                  height: (pages[index]?.height ?? estimatedPageSize(100).height) * (targetZoom / 100),
                },
              ]),
            ),
            targetZoom,
          };
        }

        applyZoom(targetZoom, mode);
        if (mode === "page" || mode === "height") {
          const currentPageIndex = Math.max(0, currentPageGroup.indexOf(currentPage));
          const coverSlotOffset = pageLayout === "spread" && showCover && currentPageGroup[0] === 1 ? 1 : 0;
          const expectedPage = pages[currentPageIndex + coverSlotOffset];
          pendingZoomAnchorRef.current = {
            page: currentPage,
            pageOffsetRatio: 0,
            expectedPageHeight: (expectedPage?.height ?? estimatedPageSize(100).height) * (targetZoom / 100),
            targetZoom,
          };
        } else if (mode === "visible") {
          pendingZoomAnchorRef.current = null;
        }
        if (mode === "page" || mode === "height" || mode === "visible") {
          setViewAlignmentRevision((revision) => revision + 1);
        }
      } catch (error) {
        if (requestId !== fitRequestSequenceRef.current) {
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (error instanceof Error && error.name === "RenderingCancelledException") {
          return;
        }

        console.warn("Nao foi possivel calcular o ajuste de visualizacao.", error);
        setReaderActionError("Não foi possível ajustar esta página. Foi mantida a visualização atual.");
      }
    },
    [
      activeBottomInset,
      activeTopInset,
      applyZoom,
      cancelInitialReadingRestore,
      currentPage,
      currentPageGroup,
      getFitPages,
      readingLeftInset,
      readingRightInset,
    ],
  );

  useEffect(() => {
    if (zoomMode === "custom" || zoomMode === "actual") {
      return;
    }

    const timerId = window.setTimeout(() => {
      void applyFitMode(zoomMode);
    }, 80);
    return () => window.clearTimeout(timerId);
  }, [
    activeBottomInset,
    activeTopInset,
    applyFitMode,
    currentPage,
    pageLayout,
    readerPanelSize.height,
    readerPanelSize.width,
    readingLeftInset,
    readingRightInset,
    showCover,
    zoomMode,
  ]);

  // O padding da area de leitura anima por 220 ms. Uma segunda ancoragem no
  // fim da transicao evita que a pagina termine alguns pixels acima/abaixo do
  // ponto preservado pelo primeiro frame. Modos de ajuste sao recalculados ja
  // com a geometria final; zoom livre apenas restaura a proporcao capturada.
  useEffect(() => {
    const transitionAnchor = readingModeTransitionAnchorRef.current;
    if (!transitionAnchor) {
      return;
    }

    const timerId = window.setTimeout(() => {
      if (readingModeTransitionAnchorRef.current !== transitionAnchor) {
        return;
      }
      readingModeTransitionAnchorRef.current = null;

      if (zoomMode !== "custom" && zoomMode !== "actual") {
        void applyFitMode(zoomMode);
        return;
      }

      const readerSurface = readerSurfaceRef.current;
      const pageElement = pageRefs.current[transitionAnchor.page - 1];
      if (!readerSurface || !pageElement) {
        return;
      }

      const targetTop = getPageAlignedScrollTop(pageElement, activeTopInset) +
        transitionAnchor.pageOffsetRatio * pageElement.offsetHeight;
      const maxTop = Math.max(0, readerSurface.scrollHeight - readerSurface.clientHeight);
      readerSurface.scrollTop = clamp(targetTop, 0, maxTop);
      centerHorizontalScroll(readerSurface);
    }, readerModeTransitionMs + 24);

    return () => window.clearTimeout(timerId);
  }, [activeTopInset, applyFitMode, isReadingMode, zoomMode]);

  useEffect(() => {
    function handleWindowResize() {
      if (isNativeFullscreen || isReaderMaximized) {
        setReaderPanelSize(getMaximizedReaderSize());
        movePanel(readerPanelId, { x: 0, y: 0 });
        return;
      }

      const nextSize = clampReaderSizeToViewport(readerPanelSize);
      const nextPosition = readerPanel
        ? clampReaderPositionToViewport(readerPanel.position, nextSize)
        : null;

      if (nextSize.width !== readerPanelSize.width || nextSize.height !== readerPanelSize.height) {
        setReaderPanelSize(nextSize);
      }

      if (
        readerPanel &&
        nextPosition &&
        (nextPosition.x !== readerPanel.position.x || nextPosition.y !== readerPanel.position.y)
      ) {
        movePanel(readerPanelId, nextPosition);
      }
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isNativeFullscreen, isReaderMaximized, movePanel, readerPanel, readerPanelId, readerPanelSize]);

  const progress = Math.round((progressPage / totalPages) * 100);

  useEffect(() => {
    if (popoutDocumentId !== document.id) {
      return;
    }

    const payload: ReaderPageStatePayload = {
      documentId: document.id,
      page: currentPage,
      progress,
      totalPages: pdfDocument?.numPages ?? null,
      fileSizeBytes,
    };
    void emitTo(READER_PANEL_WINDOW_LABEL, READER_PAGE_STATE_CHANGED_EVENT, payload).catch((error) => {
      console.warn("Nao foi possivel sincronizar a pagina atual com a popout.", error);
    });
  }, [currentPage, document.id, fileSizeBytes, pdfDocument, popoutDocumentId, progress]);
  const editingAnnotation = editingAnnotationId ? annotations.find((annotation) => annotation.id === editingAnnotationId) ?? null : null;
  const effectiveNativeFullscreen = isNativeFullscreen || readerNativeFullscreenSessionActive;

  // Entrada da pilha ainda nao criada (transitorio durante abrir/fechar).
  if (!readerPanel) {
    return null;
  }

  return (
    <FloatingPanelFrame
      panel={readerPanel}
      width={readerPanelSize.width}
      height={readerPanelSize.height}
      minWidth={Math.min(readerMinWidth, window.innerWidth)}
      minHeight={Math.min(readerMinHeight, window.innerHeight)}
      resizable={!isReaderMaximized && !effectiveNativeFullscreen}
      edgeToEdge={isReaderMaximized || effectiveNativeFullscreen}
      onResize={setReaderPanelSize}
      onFocusPanel={() => {
        if (sidePanelFloating) {
          minimizePanel(annotationsPanelId);
        }
      }}
      renderHeader={(startDragging) => (
        <ReaderFloatingChrome
          document={document}
          totalPages={totalPages}
          canGoPrevious={currentPageGroupIndex > 0}
          canGoNext={currentPageGroupIndex < pageGroups.length - 1}
          zoom={zoom}
          detailsOpen={leftPanelOpen}
          readingMode={isReadingMode}
          pageLayout={pageLayout}
          continuousScroll={continuousScroll}
          showCover={showCover}
          zoomMode={zoomMode}
          nativeFullscreen={effectiveNativeFullscreen}
          fullscreenTransitioning={isFullscreenTransitioning || Boolean(readerNativeFullscreenTransitionPromise)}
          visiblePageLabel={visiblePageLabel}
          compact={isCompactReader}
          draggable={!isReaderMaximized && !effectiveNativeFullscreen}
          onStartDragging={startDragging}
          onToggleDetails={() => setLeftPanelOpen((isOpen) => !isOpen)}
          onPreviousPage={() => {
            const previousGroup = pageGroups[currentPageGroupIndex - 1];
            if (previousGroup?.[0]) {
              scrollToPage(previousGroup[0]);
            }
          }}
          onNextPage={() => {
            const nextGroup = pageGroups[currentPageGroupIndex + 1];
            if (nextGroup?.[0]) {
              scrollToPage(nextGroup[0]);
            }
          }}
          onSearch={() => {
            if (isReadingMode) {
              changeReadingMode(false);
            } else {
              cancelReaderAutoAlignment();
              captureCurrentPageAnchor(zoomRef.current);
              setViewAlignmentRevision((revision) => revision + 1);
            }
            setLeftPanelOpen(true);
            setSearchFocusSignal((signal) => signal + 1);
          }}
          minZoom={minZoom}
          maxZoom={maxZoom}
          zoomStep={zoomStep}
          onZoomChange={changeZoom}
          onSetPageLayout={(layout) => {
            cancelReaderAutoAlignment();
            window.getSelection()?.removeAllRanges();
            setPendingSelection(null);
            captureCurrentPageAnchor(zoomRef.current);
            setPageLayout(layout);
            setViewAlignmentRevision((revision) => revision + 1);
          }}
          onToggleContinuousScroll={() => {
            cancelReaderAutoAlignment();
            captureCurrentPageAnchor(zoomRef.current);
            setContinuousScroll((enabled) => !enabled);
            setViewAlignmentRevision((revision) => revision + 1);
          }}
          onToggleShowCover={() => {
            cancelReaderAutoAlignment();
            window.getSelection()?.removeAllRanges();
            setPendingSelection(null);
            captureCurrentPageAnchor(zoomRef.current);
            setShowCover((enabled) => !enabled);
            setViewAlignmentRevision((revision) => revision + 1);
          }}
          onActualSize={() => void applyFitMode("actual")}
          onFitPage={() => void applyFitMode("page")}
          onFitWidth={() => void applyFitMode("width")}
          onFitHeight={() => void applyFitMode("height")}
          onFitVisible={() => void applyFitMode("visible")}
          onToggleReadingMode={() => changeReadingMode(!isReadingMode)}
          onToggleNativeFullscreen={() => void toggleNativeFullscreen()}
          onClose={closeAndSave}
        />
      )}
    >
      <div className="relative isolate min-h-0 flex-1 overflow-hidden bg-[var(--reader-workspace-bg)] text-[var(--foreground)]">
        <h1 className="sr-only">{document.title}</h1>
        <main
          ref={readerSurfaceRef}
          tabIndex={0}
          aria-label={`Área de leitura de ${document.title}`}
          aria-keyshortcuts="Shift+F10"
          className={`reader-reading-surface absolute inset-0 overflow-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-[-2px] ${
            continuousScroll ? "" : "snap-y snap-mandatory"
          }`}
          style={{
            paddingTop: activeTopInset,
            paddingRight: readingRightInset,
            paddingBottom: activeBottomInset,
            paddingLeft: readingLeftInset,
            scrollPaddingTop: activeTopInset,
            scrollPaddingBottom: activeBottomInset,
          }}
          onScroll={handleReaderScroll}
          onMouseUp={handleReaderMouseUp}
          onContextMenu={openReaderContextMenu}
          onKeyDown={handleReaderContextMenuKeyDown}
          onPointerDownCapture={cancelReaderAutoAlignment}
          onWheelCapture={cancelReaderAutoAlignment}
        >
          {isPdfLoading ? (
            <div className="mx-auto flex h-96 max-w-xl items-center justify-center rounded-xl border border-border-subtle bg-[var(--reader-floating-surface)] text-sm font-semibold text-text-secondary shadow-[var(--reader-floating-shadow)]">
              Carregando PDF...
            </div>
          ) : pdfError ? (
            <div className="mx-auto max-w-xl rounded-xl border border-border-subtle bg-[var(--reader-floating-surface)] px-6 py-5 text-sm font-semibold text-status-red-text shadow-[var(--reader-floating-shadow)]">
              {pdfError}
            </div>
          ) : (
            <div className="flex w-max min-w-full flex-col items-center gap-10">
              {pageGroups.map((group, groupIndex) => (
                <div
                  key={group.join("-")}
                  className={`flex w-fit items-start justify-center gap-6 ${
                    continuousScroll ? "" : "snap-start snap-always"
                  }`}
                  data-reader-page-group={groupIndex}
                >
                  {pageLayout === "spread" && showCover && group.length === 1 && group[0] === 1 ? (
                    <div
                      aria-hidden="true"
                      className="shrink-0"
                      style={{
                        width: (pageSizes.get(1) ?? defaultPageSize).width,
                        minHeight: (pageSizes.get(1) ?? defaultPageSize).height,
                      }}
                    />
                  ) : null}
                  {group.map((page) => (
                    <div
                      key={page}
                      ref={(element) => {
                        pageRefs.current[page - 1] = element;
                      }}
                      className="w-fit shrink-0"
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
              ))}
            </div>
          )}
        </main>

        <button
          ref={readingModeExitButtonRef}
          type="button"
          aria-hidden={!isReadingMode}
          aria-keyshortcuts="Escape"
          tabIndex={isReadingMode ? 0 : -1}
          className={`reader-reading-exit absolute right-[22px] top-5 z-40 rounded-[11px] border border-border-subtle bg-surface-card px-3.5 py-2 text-xs font-semibold text-text-primary shadow-[var(--reader-floating-shadow)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
            isReadingMode ? "reader-reading-exit--visible" : ""
          }`}
          onClick={() => {
            changeReadingMode(false);
            window.requestAnimationFrame(() => readerSurfaceRef.current?.focus({ preventScroll: true }));
          }}
        >
          Sair do modo de leitura <span aria-hidden="true" className="ml-1 text-text-subtle">· Esc</span>
        </button>

        <ContextMenu
          isOpen={readerContextMenu.isOpen}
          x={readerContextMenu.x}
          y={readerContextMenu.y}
          autoFocus
          onClose={closeReaderContextMenu}
        >
          <ContextMenuItem
            icon={<HeartIcon filled={document.favorite} size={16} />}
            label={isTogglingFavoriteFromContextMenu ? "Atualizando..." : document.favorite ? "Desfavoritar" : "Favoritar"}
            disabled={isTogglingFavoriteFromContextMenu}
            onSelect={() => void handleContextToggleFavorite()}
          />
          <ContextMenuDivider />
          <ContextMenuItem
            icon={<ExternalLinkIcon size={16} />}
            label={isOpeningOriginalFromContextMenu ? "Abrindo..." : "Abrir original"}
            disabled={isOpeningOriginalFromContextMenu}
            onSelect={() => void handleContextOpenOriginal()}
          />
        </ContextMenu>

        {leftPanelOpen ? (
          <div
            ref={leftIslandRef}
            aria-hidden={isReadingMode}
            className={`reader-reading-island absolute bottom-[198px] left-[22px] top-[92px] z-20 min-h-0 ${
              isReadingMode ? "reader-reading-island--hidden reader-reading-island--left" : ""
            }`}
            style={{ width: readerLeftSidebarWidth }}
          >
            <ReaderLeftSidebar
              document={document}
              pdfDocument={pdfDocument}
              outline={pdfOutline}
              currentPage={currentPage}
              totalPages={totalPages}
              fileSizeBytes={fileSizeBytes}
              progress={progress}
              searchFocusSignal={searchFocusSignal}
              onJumpToPage={scrollToPage}
              onToggleFavorite={() => onToggleFavorite(document.id)}
            />
          </div>
        ) : null}

        <ReaderToolRail
          hasSelection={pendingSelection !== null}
          right={toolRailRight}
          readingMode={isReadingMode}
          onHighlight={() => highlightSelection("amber")}
          onAnnotate={() => {
            if (pendingSelection) {
              setComposerFocusSignal((signal) => signal + 1);
            }
          }}
        />

        <div
          ref={dockIslandRef}
          aria-hidden={isReadingMode}
          className={`reader-reading-island absolute z-30 ${
            isReadingMode ? "reader-reading-island--hidden reader-reading-island--bottom" : ""
          }`}
          style={{
            right: readerSideInset,
            bottom: readerSideInset,
            left: readerSideInset,
          }}
        >
          <ReaderAnnotationsDock
            annotations={annotations}
            currentPage={currentPage}
            visiblePages={currentPageGroup}
            pendingSelection={pendingSelection}
            saveStates={saveStates}
            composerFocusSignal={composerFocusSignal}
            onJumpToPage={scrollToPage}
            onEdit={openAnnotationEditor}
            onDelete={handleDeleteAnnotationFromList}
            onRetry={retryAnnotation}
            onCreateNote={createNoteFromSelection}
          />
        </div>

        {sidePanelFloating ? (
          <ReaderSidePanel
            document={readerDocument}
            annotations={annotations}
            currentPage={currentPage}
            progress={progress}
            totalPages={pdfDocument?.numPages ?? null}
            fileSizeBytes={fileSizeBytes}
            isFloating
            onFloat={openDetachedPanel}
            onOpenSystemWindow={openPanelSystemWindow}
            onDock={() => closePanel(annotationsPanelId)}
            onJumpToPage={scrollToPage}
            onDeleteAnnotation={handleDeleteAnnotationFromList}
            onUpdateAnnotationNote={saveAnnotationNoteById}
            onToggleFavorite={() => onToggleFavorite(document.id)}
            onClose={() => closePanel(annotationsPanelId)}
          />
        ) : null}
      </div>

      {readerActionError ? (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-[10000] flex max-w-sm items-start gap-3 rounded-lg border border-status-red bg-status-red px-4 py-3 text-sm font-semibold text-status-red-text shadow-xl"
        >
          <span className="min-w-0 flex-1">{readerActionError}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            className="shrink-0 rounded p-0.5 text-lg leading-none transition hover:brightness-90"
            onClick={() => setReaderActionError("")}
          >
            ×
          </button>
        </div>
      ) : null}

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
