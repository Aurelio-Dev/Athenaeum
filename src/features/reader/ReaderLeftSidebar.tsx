import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type * as pdfjsLib from "pdfjs-dist";
import { getCenteredPanelPosition, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { useInViewport } from "../../hooks/useInViewport";
import { openDocumentExternally } from "../../lib/database";
import type { LibraryDocument } from "../../types/library";
import { notebookPanelHeight, notebookPanelWidth } from "../notebooks/notebookPanelDimensions";
import { DetailsTab } from "./panels/DetailsTab";
import { createDocumentTextSearcher, type DocumentSearchResult } from "./pdfTextSearch";

export const readerLeftSidebarWidth = 306;

type PdfDocument = pdfjsLib.PDFDocumentProxy;

// Item do sumario do PDF ja com a pagina resolvida pelo ReaderModal (itens sem
// destino resolvivel ficam sem pagina e aparecem nao-clicaveis).
export type PdfOutlineItem = {
  title: string;
  page?: number;
};

export type ReaderSidebarView = "outline" | "thumbnails" | "bookmarks" | "details";

type ReaderLeftSidebarProps = {
  document: LibraryDocument;
  pdfDocument: PdfDocument | null;
  outline: PdfOutlineItem[];
  currentPage: number;
  totalPages: number;
  fileSizeBytes: number | null;
  progress: number;
  // Incrementado pelo ReaderModal no Ctrl+F: foca o campo de busca mesmo que a
  // sidebar tenha acabado de ser aberta (sinal deterministico, sem timers).
  searchFocusSignal: number;
  onJumpToPage: (page: number) => void;
  onToggleFavorite: () => Promise<void>;
};

const tabs: Array<{ id: ReaderSidebarView; label: string; disabled?: boolean }> = [
  { id: "outline", label: "Sumário" },
  { id: "thumbnails", label: "Miniaturas" },
  { id: "bookmarks", label: "Marcadores", disabled: true },
  { id: "details", label: "Detalhes" },
];

const thumbnailWidth = 60;
const minSearchTermLength = 2;

function SidebarViewIcon({ view }: { view: ReaderSidebarView }) {
  const commonProps = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (view === "outline") {
    return (
      <svg {...commonProps}>
        <line x1="8" x2="21" y1="6" y2="6" />
        <line x1="8" x2="21" y1="12" y2="12" />
        <line x1="8" x2="21" y1="18" y2="18" />
        <line x1="3" x2="3.01" y1="6" y2="6" />
        <line x1="3" x2="3.01" y1="12" y2="12" />
        <line x1="3" x2="3.01" y1="18" y2="18" />
      </svg>
    );
  }

  if (view === "thumbnails") {
    return (
      <svg {...commonProps}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  }

  if (view === "bookmarks") {
    return (
      <svg {...commonProps}>
        <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="m6 6 12 12" />
      <path d="m18 6-12 12" />
    </svg>
  );
}

function BookmarkIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4.5h12A0.5 0.5 0 0 1 18.5 5v15.5L12 16l-6.5 4.5V5A0.5 0.5 0 0 1 6 4.5z" />
    </svg>
  );
}

// Miniatura de uma pagina, renderizada pelo pdf.js apos entrar (perto) da
// viewport da lista e mantida depois disso (canvas pequeno, custo de memoria
// baixo mesmo em PDFs longos).
function PageThumbnailCanvas({ pdfDocument, page }: { pdfDocument: PdfDocument; page: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let isCancelled = false;
    let renderTask: pdfjsLib.RenderTask | null = null;

    async function renderThumbnail() {
      const pdfPage = await pdfDocument.getPage(page);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: thumbnailWidth / baseViewport.width });
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

  return <canvas ref={canvasRef} className="block" />;
}

type ThumbnailRowProps = {
  pdfDocument: PdfDocument | null;
  page: number;
  active: boolean;
  sectionTitle: string | null;
  onClick: () => void;
};

function ThumbnailRow({ pdfDocument, page, active, sectionTitle, onClick }: ThumbnailRowProps) {
  const { elementRef, isInViewport } = useInViewport<HTMLDivElement>("400px 0px");
  const [hasRendered, setHasRendered] = useState(false);

  useEffect(() => {
    if (isInViewport) {
      setHasRendered(true);
    }
  }, [isInViewport]);

  return (
    <div ref={elementRef} data-thumbnail-page={page}>
      <button
        type="button"
        aria-current={active ? "page" : undefined}
        className={`grid w-full grid-cols-[24px_auto_minmax(0,1fr)] items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-primary/60 ${
          active
            ? "border-primary bg-[var(--color-accent-tint-bg)]"
            : "border-border-subtle bg-[var(--card)] hover:border-primary/60 hover:bg-[var(--muted)]"
        }`}
        onClick={onClick}
      >
        <span className={`text-center text-xs tabular-nums ${active ? "font-bold text-primary" : "text-[var(--muted-foreground)]"}`}>{page}</span>
        <span className={`overflow-hidden rounded border bg-white ${active ? "border-primary" : "border-border-subtle"}`} style={{ width: thumbnailWidth }}>
          {pdfDocument && hasRendered ? (
            <PageThumbnailCanvas pdfDocument={pdfDocument} page={page} />
          ) : (
            // Pulsa so enquanto ha um PDF por renderizar; sem PDF (documento
            // fallback) o bloco fica estatico.
            <span
              className={`block bg-slate-100 ${pdfDocument ? "animate-pulse" : ""}`}
              style={{ width: thumbnailWidth, height: Math.round(thumbnailWidth * 1.3) }}
            />
          )}
        </span>
        <span className="text-xs leading-5 text-[var(--foreground)]">{sectionTitle}</span>
      </button>
    </div>
  );
}

export function ReaderLeftSidebar({
  document,
  pdfDocument,
  outline,
  currentPage,
  totalPages,
  fileSizeBytes,
  progress,
  searchFocusSignal,
  onJumpToPage,
  onToggleFavorite,
}: ReaderLeftSidebarProps) {
  const [activeView, setActiveView] = useState<ReaderSidebarView>("details");
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const tabIdPrefix = useId();
  const { openPanel } = useFloatingPanels();
  const queryClient = useQueryClient();

  const searcher = useMemo(() => (pdfDocument ? createDocumentTextSearcher(pdfDocument) : null), [pdfDocument]);
  const trimmedSearchTerm = searchTerm.trim();
  const isSearchActive = trimmedSearchTerm.length > 0;

  // Primeiro item do sumario que comeca em cada pagina — exibido ao lado da
  // miniatura correspondente, como na referencia.
  const sectionTitleByPage = useMemo(() => {
    const titles = new Map<number, string>();
    for (const item of outline) {
      if (item.page !== undefined && !titles.has(item.page)) {
        titles.set(item.page, item.title);
      }
    }
    return titles;
  }, [outline]);

  const pageNumbers = useMemo(() => Array.from({ length: totalPages }, (_, index) => index + 1), [totalPages]);

  // Ctrl+F no leitor: revela o campo. O foco acontece no efeito seguinte,
  // depois que o input entrou no DOM.
  useEffect(() => {
    if (searchFocusSignal > 0) {
      setIsSearchOpen(true);
    }
  }, [searchFocusSignal]);

  useEffect(() => {
    if (!isSearchOpen) {
      return;
    }

    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, [isSearchOpen, searchFocusSignal]);

  // Busca debounced com cancelamento: digitar por cima invalida a busca em
  // andamento (a flag para o loop de paginas do searcher).
  useEffect(() => {
    if (!searcher || trimmedSearchTerm.length < minSearchTermLength) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const cancellation = { cancelled: false };
    setIsSearching(true);

    const timer = window.setTimeout(() => {
      searcher
        .search(trimmedSearchTerm, cancellation)
        .then((results) => {
          if (!cancellation.cancelled) {
            setSearchResults(results);
            setIsSearching(false);
          }
        })
        .catch((error) => {
          console.warn("Não foi possível buscar no documento.", error);
          if (!cancellation.cancelled) {
            setSearchResults([]);
            setIsSearching(false);
          }
        });
    }, 300);

    return () => {
      cancellation.cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searcher, trimmedSearchTerm]);

  // Mantem a miniatura da pagina atual visivel enquanto o usuario rola o PDF.
  useEffect(() => {
    if (activeView !== "thumbnails" || isSearchActive) {
      return;
    }

    const activeElement = listRef.current?.querySelector(`[data-thumbnail-page="${currentPage}"]`);
    activeElement?.scrollIntoView({ block: "nearest" });
  }, [activeView, currentPage, isSearchActive]);

  function closeSearch() {
    setSearchTerm("");
    setIsSearchOpen(false);
  }

  function selectView(view: ReaderSidebarView) {
    closeSearch();
    setActiveView(view);
  }

  function openNotebookPanel(notebookId: number) {
    const width = Math.min(notebookPanelWidth, window.innerWidth);
    const height = Math.min(notebookPanelHeight, window.innerHeight);
    openPanel("notebook", String(notebookId), getCenteredPanelPosition(width, height));
  }

  function handleTagsChanged() {
    void queryClient.invalidateQueries({ queryKey: ["library"] });
  }

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, currentView: ReaderSidebarView) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    const enabledTabs = tabs.filter((tab) => !tab.disabled);
    const currentIndex = enabledTabs.findIndex((tab) => tab.id === currentView);
    let nextIndex = currentIndex;

    if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = enabledTabs.length - 1;
    } else if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % enabledTabs.length;
    } else {
      nextIndex = (currentIndex - 1 + enabledTabs.length) % enabledTabs.length;
    }

    const nextTab = enabledTabs[nextIndex];
    if (!nextTab) {
      return;
    }

    event.preventDefault();
    selectView(nextTab.id);
    window.document.getElementById(`${tabIdPrefix}-${nextTab.id}-tab`)?.focus();
  }

  const panelContent = isSearchActive ? (
    trimmedSearchTerm.length < minSearchTermLength ? (
      <p role="status" className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">
        Digite ao menos {minSearchTermLength} caracteres para buscar.
      </p>
    ) : isSearching ? (
      <p role="status" className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">Buscando no documento...</p>
    ) : searchResults.length > 0 ? (
      <ul className="space-y-2">
        {searchResults.map((result, index) => (
          <li key={`${result.page}-${index}`}>
            <button
              type="button"
              className="w-full rounded-lg border border-border-subtle bg-[var(--card)] px-3 py-2 text-left outline-none transition hover:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/60"
              onClick={() => onJumpToPage(result.page)}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Página {result.page}</p>
              <p className="mt-1 text-xs leading-5 text-[var(--foreground)]">
                {result.before}
                <strong className="font-bold text-primary">{result.match}</strong>
                {result.after}
              </p>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p role="status" className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">Nenhum resultado para “{trimmedSearchTerm}”.</p>
    )
  ) : activeView === "thumbnails" ? (
    <div className="space-y-2">
      {pageNumbers.map((page) => (
        <ThumbnailRow
          key={page}
          pdfDocument={pdfDocument}
          page={page}
          active={page === currentPage}
          sectionTitle={sectionTitleByPage.get(page) ?? null}
          onClick={() => onJumpToPage(page)}
        />
      ))}
    </div>
  ) : activeView === "outline" ? (
    outline.length > 0 ? (
      <div className="space-y-0.5">
        {outline.map((item, index) => (
          <button
            key={`${item.title}-${index}`}
            type="button"
            disabled={item.page === undefined}
            title={item.page === undefined ? "Este item do sumário não tem página associada." : undefined}
            className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-left text-[13px] leading-[19.5px] text-[var(--foreground)] outline-none transition hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
            onClick={() => {
              if (item.page !== undefined) {
                onJumpToPage(item.page);
              }
            }}
          >
            <span className="min-w-0 flex-1 break-words">{item.title}</span>
            {item.page !== undefined ? <span className="shrink-0 text-[11px] tabular-nums text-[var(--muted-foreground)]">{item.page}</span> : null}
          </button>
        ))}
      </div>
    ) : (
      <p className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">Este PDF não possui sumário.</p>
    )
  ) : activeView === "details" ? (
    <DetailsTab
      document={document}
      progress={progress}
      totalPages={totalPages}
      fileSizeBytes={fileSizeBytes}
      onOpenNotebook={openNotebookPanel}
      onToggleFavorite={onToggleFavorite}
      onOpenExternally={() => openDocumentExternally(document.id)}
      showFooterActions={false}
      onTagsChanged={handleTagsChanged}
    />
  ) : (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border-subtle px-4 py-8 text-center text-[var(--muted-foreground)]">
      <BookmarkIcon />
      <p className="mt-3 text-xs leading-5">Marcadores estarão disponíveis em uma próxima entrega.</p>
    </div>
  );

  return (
    <aside
      aria-label="Painel do documento"
      className="flex h-full shrink-0 flex-col overflow-hidden rounded-[14px] border border-border-subtle bg-[var(--reader-floating-surface)] font-sans text-[var(--foreground)]"
      style={{ width: readerLeftSidebarWidth, boxShadow: "var(--reader-sidebar-shadow)" }}
    >
      <div
        role="tablist"
        aria-label="Visualizações do documento"
        className="flex shrink-0 gap-[3px] border-b px-3 py-[11px]"
        style={{ borderColor: "var(--reader-island-divider)" }}
      >
        {tabs.map((tab) => {
          const isSelected = activeView === tab.id;
          const disabledTitle = "Marcadores estarão disponíveis em uma próxima entrega.";

          return (
            <button
              key={tab.id}
              id={`${tabIdPrefix}-${tab.id}-tab`}
              type="button"
              role="tab"
              aria-label={tab.disabled ? `${tab.label} — indisponível nesta versão` : tab.label}
              aria-selected={isSelected}
              aria-controls={`${tabIdPrefix}-panel`}
              disabled={tab.disabled}
              title={tab.disabled ? disabledTitle : tab.label}
              tabIndex={isSelected ? 0 : -1}
              className={`inline-flex h-[30px] min-w-0 flex-1 items-center justify-center rounded-[7px] outline-none transition focus-visible:ring-2 focus-visible:ring-primary/60 disabled:cursor-not-allowed disabled:opacity-50 ${
                isSelected
                  ? "bg-[var(--color-accent-tint-bg)] text-primary"
                  : "text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => selectView(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            >
              <SidebarViewIcon view={tab.id} />
            </button>
          );
        })}
      </div>

      {isSearchOpen ? (
        <div className="shrink-0 border-b px-3 py-3" style={{ borderColor: "var(--reader-island-divider)" }}>
          <div className="flex h-9 items-center gap-2 rounded-[9px] border border-border-subtle bg-[var(--background)] px-2.5 text-[var(--muted-foreground)] focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30">
            <SearchIcon />
            <input
              ref={searchInputRef}
              value={searchTerm}
              disabled={!pdfDocument}
              autoComplete="off"
              spellCheck={false}
              placeholder="Buscar no documento..."
              aria-label="Buscar no documento"
              className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-not-allowed"
              onChange={(event) => setSearchTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") {
                  return;
                }

                // Esc limpa primeiro o termo; um segundo Esc fecha a busca sem
                // deixar o evento global fechar o Reader.
                event.preventDefault();
                event.stopPropagation();

                if (searchTerm.length > 0) {
                  setSearchTerm("");
                  return;
                }

                closeSearch();
              }}
            />
            <button
              type="button"
              aria-label="Fechar busca"
              title="Fechar busca"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition hover:bg-[var(--muted)] hover:text-[var(--foreground)] focus-visible:ring-2 focus-visible:ring-primary/60"
              onClick={closeSearch}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      ) : null}

      <div
        ref={listRef}
        id={`${tabIdPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${tabIdPrefix}-${activeView}-tab`}
        aria-busy={isSearchActive && isSearching}
        className={`sidebar-scroll min-h-0 flex-1 overflow-y-auto ${!isSearchActive && activeView === "details" ? "" : "px-4 py-4"}`}
      >
        {panelContent}
      </div>
    </aside>
  );
}
