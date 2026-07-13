import { useEffect, useMemo, useRef, useState } from "react";
import type * as pdfjsLib from "pdfjs-dist";
import newLogoSmall from "../../assets/icons/new-logo-small.svg";
import { getCenteredPanelPosition, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { HeartIcon } from "../../components/ui/SharedIcons";
import { useContextMenu } from "../../hooks/useContextMenu";
import { useInViewport } from "../../hooks/useInViewport";
import { useTheme } from "../../hooks/useTheme";
import { openDocumentExternally } from "../../lib/database";
import { settingsPanelHeight, settingsPanelWidth } from "../settings/SettingsPanel";
import type { LibraryDocument, LibraryRoute } from "../../types/library";
import { formatFileSize } from "./panels/DocumentInfoSections";
import { ExternalLinkIcon } from "./panels/readerPanelIcons";
import { createDocumentTextSearcher, type DocumentSearchResult } from "./pdfTextSearch";

type PdfDocument = pdfjsLib.PDFDocumentProxy;

// Item do sumario do PDF ja com a pagina resolvida pelo ReaderModal (itens sem
// destino resolvivel ficam sem pagina e aparecem nao-clicaveis).
export type PdfOutlineItem = {
  title: string;
  page?: number;
};

type SidebarTab = "thumbnails" | "outline" | "bookmarks";

type ReaderLeftSidebarProps = {
  document: LibraryDocument;
  pdfDocument: PdfDocument | null;
  outline: PdfOutlineItem[];
  currentPage: number;
  totalPages: number;
  fileSizeBytes: number | null;
  // Incrementado pelo ReaderModal no Ctrl+F: foca o campo de busca mesmo que a
  // sidebar tenha acabado de ser aberta (sinal deterministico, sem timers).
  searchFocusSignal: number;
  onJumpToPage: (page: number) => void;
  onNavigate: (route: LibraryRoute) => void;
  onToggleFavorite: () => void;
};

const tabs: Array<{ id: SidebarTab; label: string }> = [
  { id: "thumbnails", label: "Miniaturas" },
  { id: "outline", label: "Sumário" },
  { id: "bookmarks", label: "Marcadores" },
];

const thumbnailWidth = 60;
const minSearchTermLength = 2;

type NavIconName = "library" | "clock" | "heart" | "trash";

function NavIcon({ name }: { name: NavIconName }) {
  const commonProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "library") {
    return (
      <svg {...commonProps}>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <rect x="14" y="14" width="6" height="6" rx="1" />
      </svg>
    );
  }

  if (name === "clock") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
    );
  }

  if (name === "heart") {
    return (
      <svg {...commonProps}>
        <path d="M19 8.5c0-2.3-1.9-4-4.1-4-1.3 0-2.3.5-2.9 1.4C11.4 5 10.4 4.5 9.1 4.5 6.9 4.5 5 6.2 5 8.5c0 2.3 1.5 4 3 5.5l4 3.8 4-3.8c1.5-1.5 3-3.2 3-5.5z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M4 7h16" />
      <path d="M18 7v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function ThemeIcon({ name }: { name: "sun" | "moon" }) {
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

  if (name === "sun") {
    return (
      <svg {...commonProps}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2" />
        <path d="M12 20v2" />
        <path d="m4.93 4.93 1.41 1.41" />
        <path d="m17.66 17.66 1.41 1.41" />
        <path d="M2 12h2" />
        <path d="M20 12h2" />
        <path d="m6.34 17.66-1.41 1.41" />
        <path d="m19.07 4.93-1.41 1.41" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a7 7 0 1 0 11 11z" />
    </svg>
  );
}

function PdfFileIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="19" r="1" />
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

const navItems: Array<{ label: string; icon: NavIconName; route: LibraryRoute }> = [
  { label: "Biblioteca", icon: "library", route: { type: "all" } },
  { label: "Recentes", icon: "clock", route: { type: "recent" } },
  { label: "Favoritos", icon: "heart", route: { type: "favorites" } },
  { label: "Lixeira", icon: "trash", route: { type: "trash" } },
];

function formatReadingTime(totalSeconds: number) {
  if (totalSeconds < 60) {
    return "Menos de 1 min de leitura";
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes} min de leitura`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min de leitura` : `${hours} h de leitura`;
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
        className={`grid w-full grid-cols-[24px_auto_minmax(0,1fr)] items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition ${
          active ? "border-primary bg-[var(--muted)]" : "border-border-subtle bg-[var(--background)] hover:border-primary/60"
        }`}
        onClick={onClick}
      >
        <span className="text-center text-xs tabular-nums text-[var(--muted-foreground)]">{page}</span>
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
  searchFocusSignal,
  onJumpToPage,
  onNavigate,
  onToggleFavorite,
}: ReaderLeftSidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>("thumbnails");
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<DocumentSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const documentMenu = useContextMenu();
  const { theme, toggleTheme } = useTheme();
  const { openPanel } = useFloatingPanels();

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

  // Ctrl+F no leitor: foca e seleciona o campo de busca.
  useEffect(() => {
    if (searchFocusSignal > 0) {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    }
  }, [searchFocusSignal]);

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
    if (activeTab !== "thumbnails" || isSearchActive) {
      return;
    }

    const activeElement = listRef.current?.querySelector(`[data-thumbnail-page="${currentPage}"]`);
    activeElement?.scrollIntoView({ block: "nearest" });
  }, [activeTab, currentPage, isSearchActive]);

  function handleOpenExternally() {
    documentMenu.close();
    void openDocumentExternally(document.id).catch((error) => {
      console.warn("Não foi possível abrir o PDF externamente.", error);
    });
  }

  function handleToggleFavorite() {
    documentMenu.close();
    onToggleFavorite();
  }

  function openSettings() {
    openPanel("settings", "app", getCenteredPanelPosition(settingsPanelWidth, settingsPanelHeight));
  }

  const listContent = isSearchActive ? (
    trimmedSearchTerm.length < minSearchTermLength ? (
      <p className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">Digite ao menos {minSearchTermLength} caracteres para buscar.</p>
    ) : isSearching ? (
      <p className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">Buscando no documento...</p>
    ) : searchResults.length > 0 ? (
      <ul className="space-y-2">
        {searchResults.map((result, index) => (
          <li key={`${result.page}-${index}`}>
            <button
              type="button"
              className="w-full rounded-lg border border-border-subtle bg-[var(--background)] px-3 py-2 text-left transition hover:border-primary/60"
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
      <p className="px-1 text-xs leading-5 text-[var(--muted-foreground)]">Nenhum resultado para “{trimmedSearchTerm}”.</p>
    )
  ) : activeTab === "thumbnails" ? (
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
  ) : activeTab === "outline" ? (
    outline.length > 0 ? (
      <div className="space-y-0.5">
        {outline.map((item, index) => (
          <button
            key={`${item.title}-${index}`}
            type="button"
            disabled={item.page === undefined}
            title={item.page === undefined ? "Este item do sumário não tem página associada." : undefined}
            className="flex w-full items-baseline justify-between gap-3 rounded-md px-2.5 py-2 text-left text-xs leading-5 text-[var(--foreground)] transition hover:bg-[var(--muted)] disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
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
  ) : (
    <div className="flex flex-col items-center rounded-lg border border-dashed border-border-subtle px-4 py-8 text-center text-[var(--muted-foreground)]">
      <BookmarkIcon />
      <p className="mt-3 text-xs leading-5">Os marcadores de página estarão disponíveis em uma próxima fase.</p>
    </div>
  );

  return (
    <aside className="relative z-20 flex h-full w-[280px] shrink-0 flex-col border-r border-border-subtle bg-[var(--card)]">
      <div className="flex shrink-0 items-center gap-2 px-5 pb-1 pt-4">
        <img src={newLogoSmall} alt="" className="h-6 w-6 shrink-0 -translate-y-px" />
        <span className="font-serif text-lg font-medium text-[var(--foreground)]">Athenaeum</span>
      </div>

      <nav className="shrink-0 px-3 pt-2">
        {navItems.map((item) => (
          <button
            key={item.label}
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] leading-[19.5px] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            onClick={() => onNavigate(item.route)}
          >
            <NavIcon name={item.icon} />
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </nav>

      <div className="shrink-0 px-4 pt-4">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--muted-foreground)]">Documento atual</h2>
        <div className="mt-2 rounded-lg border border-border-subtle bg-[var(--background)] p-3">
          <div className="flex items-start gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-status-red text-text-inverse">
              <PdfFileIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-[var(--foreground)]" title={document.fileName ?? document.title}>
                {document.fileName ?? document.title}
              </p>
              <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">{document.authors[0] ?? "Sem autor"}</p>
              <p className="mt-0.5 truncate text-[10px] text-[var(--muted-foreground)]">
                {document.year} · {formatFileSize(fileSizeBytes)}
              </p>
            </div>
            <button
              type="button"
              aria-label="Opções do documento"
              title="Opções do documento"
              aria-haspopup="menu"
              aria-expanded={documentMenu.isOpen}
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
              onClick={documentMenu.open}
            >
              <MoreVerticalIcon />
            </button>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--muted-foreground)]">
            <InfoIcon />
            {formatReadingTime(document.timeSpentSeconds)}
          </p>
        </div>
        <ContextMenu isOpen={documentMenu.isOpen} x={documentMenu.x} y={documentMenu.y} onClose={documentMenu.close}>
          <ContextMenuItem
            icon={<HeartIcon filled={document.favorite} size={16} />}
            label={document.favorite ? "Desfavoritar" : "Favoritar"}
            onSelect={handleToggleFavorite}
          />
          <ContextMenuItem icon={<ExternalLinkIcon />} label="Abrir externamente" onSelect={handleOpenExternally} />
        </ContextMenu>
      </div>

      <div className="shrink-0 px-4 pt-3">
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-[var(--background)] px-2.5 py-2 focus-within:border-primary">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <line x1="20.5" x2="16.5" y1="20.5" y2="16.5" />
          </svg>
          <input
            ref={searchInputRef}
            value={searchTerm}
            disabled={!pdfDocument}
            placeholder="Buscar no documento..."
            aria-label="Buscar no documento"
            className="min-w-0 flex-1 bg-transparent text-xs text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)] disabled:cursor-not-allowed"
            onChange={(event) => setSearchTerm(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") {
                return;
              }

              // Esc no campo: limpa a busca (ou tira o foco) SEM deixar o
              // evento subir ate o handler global que fecha o leitor.
              event.preventDefault();
              event.stopPropagation();

              if (searchTerm.length > 0) {
                setSearchTerm("");
                return;
              }

              event.currentTarget.blur();
            }}
          />
          <kbd className="shrink-0 rounded border border-border-subtle bg-[var(--muted)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--muted-foreground)]">Ctrl + F</kbd>
        </div>
      </div>

      <div className="shrink-0 px-4 pt-3">
        <div className="grid grid-cols-3 rounded-lg border border-border-subtle bg-[var(--muted)] p-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`rounded-md px-1 py-1.5 text-[11px] font-semibold transition ${
                activeTab === tab.id && !isSearchActive
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
              onClick={() => {
                setSearchTerm("");
                setActiveTab(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={listRef} className="sidebar-scroll min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {listContent}
      </div>

      <div className="flex shrink-0 items-center justify-between border-t border-border-subtle px-4 py-3">
        <button
          type="button"
          className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] text-[var(--muted-foreground)] transition hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
          title="Ajustes"
          onClick={openSettings}
        >
          <GearIcon />
          Ajustes
        </button>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[var(--muted)] text-[var(--foreground)] transition hover:brightness-110"
          aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          title={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          aria-pressed={theme === "dark"}
          onClick={toggleTheme}
        >
          <ThemeIcon name={theme === "dark" ? "sun" : "moon"} />
        </button>
      </div>
    </aside>
  );
}
