import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import { TagBadge } from "../../components/TagBadge";
import type { LibraryDocument, ReadingLocation } from "../../types/library";

type PdfDocument = pdfjsLib.PDFDocumentProxy;
type PdfOutlineItem = {
  title: string;
};

type ReaderModalProps = {
  document: LibraryDocument;
  onClose: (readingLocation: ReadingLocation) => void;
  onSaveNotes: (documentId: string, notes: string) => void;
};

const fallbackPageCount = 15;
const minZoom = 70;
const maxZoom = 140;
const zoomStep = 10;

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function Icon({ name }: { name: "back" | "close" | "leftPanel" | "notes" | "prev" | "next" | "minus" | "plus" | "search" }) {
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

function formatAuthors(authors: string[]) {
  return authors.length > 4 ? `${authors.slice(0, 4).join(", ")} et al.` : authors.join(", ");
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

function PdfCanvasPage({ pdfDocument, pageNumber, zoom }: { pdfDocument: PdfDocument; pageNumber: number; zoom: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isRendering, setIsRendering] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderPage() {
      setIsRendering(true);
      const page = await pdfDocument.getPage(pageNumber);
      const viewport = page.getViewport({ scale: (zoom / 100) * 1.35 });
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
  }, [pageNumber, pdfDocument, zoom]);

  return (
    <article className="mx-auto overflow-hidden bg-white shadow-[0_18px_42px_rgba(15,23,42,0.18)]">
      {isRendering ? <div className="h-[72vh] w-[min(850px,calc(100vw-64px))] animate-pulse bg-white" /> : null}
      <canvas ref={canvasRef} className={isRendering ? "hidden" : "block"} />
    </article>
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

export function ReaderModal({ document, onClose, onSaveNotes }: ReaderModalProps) {
  const fallbackPageNumbers = useMemo(buildFallbackPageNumbers, []);
  const readerSurfaceRef = useRef<HTMLElement | null>(null);
  const pageRefs = useRef<Array<HTMLElement | null>>([]);
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [pdfOutline, setPdfOutline] = useState<PdfOutlineItem[]>([]);
  const [pdfError, setPdfError] = useState("");
  const [isPdfLoading, setIsPdfLoading] = useState(hasPdfSource(document));
  const [totalPages, setTotalPages] = useState(hasPdfSource(document) ? 1 : fallbackPageCount);
  const [currentPage, setCurrentPage] = useState(document.readingLocation?.page ?? Math.max(1, Math.ceil((document.progress / 100) * totalPages)));
  const [zoom, setZoom] = useState(getInitialZoom(document));
  const [leftPanelOpen, setLeftPanelOpen] = useState(true);
  const [leftPanelTab, setLeftPanelTab] = useState<"pages" | "summary">("pages");
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesText, setNotesText] = useState(document.notes ?? "");

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, index) => index + 1), [totalPages]);

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
  }, [document.id, document.notes]);

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
    onClose(getCurrentReadingLocation());
  }, [getCurrentReadingLocation, onClose]);

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
      if (event.key === "Escape") {
        closeAndSave();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeAndSave]);

  function handleReaderScroll() {
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
  }

  function changeZoom(nextZoom: number) {
    setZoom(clamp(nextZoom, minZoom, maxZoom));
  }

  const progress = Math.round((currentPage / totalPages) * 100);
  const summaryItems = pdfOutline.length > 0 ? pdfOutline : ["Resumo", "Arquitetura", "Treinamento", "Resultados", "Conclusoes"].map((title) => ({ title }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#11131d] text-slate-200" role="dialog" aria-modal="true" aria-labelledby="reader-title">
      <header className="flex h-[70px] shrink-0 items-center border-b border-slate-800 bg-[#11131d]">
        <div className="flex min-w-0 flex-1 items-center gap-5 px-6">
          <button type="button" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-400 hover:text-white" onClick={closeAndSave}>
            <Icon name="back" />
            Biblioteca
          </button>
          <div className="h-7 w-px bg-slate-800" />
          <h1 id="reader-title" className="truncate text-sm font-bold text-white">
            {document.title}
          </h1>
        </div>

        <div className="flex shrink-0 items-center gap-3 px-5">
          <button
            type="button"
            aria-label="Miniaturas e sumario"
            title="Miniaturas e sumario"
            className={`rounded-lg p-2 transition ${leftPanelOpen ? "bg-primary text-white ring-1 ring-indigo-200" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
            onClick={() => setLeftPanelOpen((isOpen) => !isOpen)}
          >
            <Icon name="leftPanel" />
          </button>
          <button
            type="button"
            aria-label="Anotacoes"
            title="Anotacoes"
            className={`rounded-lg p-2 transition ${notesOpen ? "bg-primary text-white ring-1 ring-indigo-200" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
            onClick={() => setNotesOpen((isOpen) => !isOpen)}
          >
            <Icon name="notes" />
          </button>
          <div className="h-7 w-px bg-slate-800" />
          <button type="button" aria-label="Pagina anterior" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => scrollToPage(Math.max(1, currentPage - 1))}>
            <Icon name="prev" />
          </button>
          <span className="min-w-14 text-center text-sm font-semibold text-blue-200">
            {currentPage} / {totalPages}
          </span>
          <button type="button" aria-label="Proxima pagina" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => scrollToPage(Math.min(totalPages, currentPage + 1))}>
            <Icon name="next" />
          </button>
          <div className="h-7 w-px bg-slate-800" />
          <button type="button" aria-label="Reduzir zoom" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => changeZoom(zoom - zoomStep)}>
            <Icon name="minus" />
          </button>
          <span className="min-w-16 text-center text-sm font-semibold text-blue-200">{zoom}%</span>
          <button type="button" aria-label="Aumentar zoom" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white" onClick={() => changeZoom(zoom + zoomStep)}>
            <Icon name="plus" />
          </button>
          <div className="h-7 w-px bg-slate-800" />
          <button type="button" aria-label="Buscar no documento" className="rounded-md p-2 text-slate-400 hover:bg-slate-800 hover:text-white">
            <Icon name="search" />
          </button>
        </div>
      </header>

      <div className="h-1 shrink-0 bg-primary" style={{ width: `${progress}%` }} />

      <div className="relative min-h-0 flex flex-1 overflow-hidden bg-[#dfe1e7]">
        {leftPanelOpen ? (
          <aside className="absolute inset-y-0 left-0 z-20 flex w-60 shrink-0 flex-col border-r border-slate-300 bg-surface-panel shadow-2xl md:relative md:shadow-none">
            <div className="grid grid-cols-2 border-b border-border-subtle text-sm font-semibold">
              <button
                type="button"
                className={`px-4 py-4 ${leftPanelTab === "pages" ? "border-b-2 border-primary text-primary" : "text-text-subtle"}`}
                onClick={() => setLeftPanelTab("pages")}
              >
                Paginas
              </button>
              <button
                type="button"
                className={`px-4 py-4 ${leftPanelTab === "summary" ? "border-b-2 border-primary text-primary" : "text-text-subtle"}`}
                onClick={() => setLeftPanelTab("summary")}
              >
                Sumario
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5">
              {leftPanelTab === "pages" ? (
                <div className="space-y-7">
                  {pageNumbers.map((page) =>
                    pdfDocument ? (
                      <PdfThumbnail key={page} pdfDocument={pdfDocument} page={page} active={page === currentPage} onClick={() => scrollToPage(page)} />
                    ) : (
                      <FallbackThumbnail key={page} page={page} active={page === currentPage} onClick={() => scrollToPage(page)} />
                    ),
                  )}
                </div>
              ) : (
                <nav className="space-y-2 text-sm">
                  {summaryItems.map((item, index) => (
                    <button
                      key={`${item.title}-${index}`}
                      type="button"
                      className={`block w-full rounded-lg px-3 py-2 text-left ${index + 1 === currentPage ? "bg-primary-soft text-primary" : "text-text-secondary hover:bg-surface-muted"}`}
                      onClick={() => scrollToPage(clamp(index * 2 + 1, 1, totalPages))}
                    >
                      {item.title}
                    </button>
                  ))}
                </nav>
              )}
            </div>
          </aside>
        ) : null}

        <main ref={readerSurfaceRef} className="min-w-0 flex-1 overflow-y-auto px-5 py-8" onScroll={handleReaderScroll}>
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
                >
                  {pdfDocument ? (
                    <PdfCanvasPage pdfDocument={pdfDocument} pageNumber={page} zoom={zoom} />
                  ) : (
                    <FallbackReaderPage page={page} zoom={zoom} document={document} />
                  )}
                </div>
              ))}
            </div>
          )}
        </main>

        {notesOpen ? (
          <aside className="absolute inset-y-0 right-0 z-20 w-[326px] max-w-[calc(100vw-32px)] shrink-0 border-l border-slate-300 bg-surface-panel shadow-2xl lg:relative lg:shadow-none">
            <header className="flex items-center border-b border-border-subtle px-5 py-4">
              <h2 className="text-base font-semibold text-text-primary">Anotacoes</h2>
              <button type="button" aria-label="Fechar anotacoes" className="ml-auto rounded-md p-2 text-text-subtle hover:bg-surface-muted" onClick={() => setNotesOpen(false)}>
                <Icon name="close" />
              </button>
            </header>

            <div className="px-5 py-5">
              <div className="rounded-lg border border-border-subtle bg-surface-card p-4">
                <h3 className="font-semibold text-text-primary">{document.title}</h3>
                <p className="mt-2 text-sm text-text-secondary">
                  {formatAuthors(document.authors)} - {document.year}
                </p>
              </div>

              <div className="mt-5">
                <p className="text-xs font-bold uppercase tracking-wider text-text-subtle">Tags</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {document.tags.map((tag) => (
                    <TagBadge key={tag} tag={tag} />
                  ))}
                </div>
              </div>

              <label className="mt-6 block">
                <span className="text-xs font-bold uppercase tracking-wider text-text-subtle">Notas</span>
                <textarea
                  className="mt-3 h-64 w-full resize-none rounded-lg border border-border-muted bg-surface-panel px-4 py-3 text-sm leading-6 text-text-primary outline-none focus:border-primary"
                  value={notesText}
                  placeholder="Escreva suas anotacoes sobre este PDF. Elas serao salvas automaticamente."
                  onChange={(event) => {
                    const nextNotes = event.target.value;
                    setNotesText(nextNotes);
                    onSaveNotes(document.id, nextNotes);
                  }}
                />
              </label>

              <div className="mt-6">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-text-secondary">Progresso geral</span>
                  <span className="font-bold text-primary">{progress}%</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-subtle">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
