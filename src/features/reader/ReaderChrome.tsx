import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { ContextMenu } from "../../components/ui/ContextMenu";
import { ContextMenuDivider } from "../../components/ui/ContextMenuDivider";
import { ContextMenuItem } from "../../components/ui/ContextMenuItem";
import { useContextMenu } from "../../hooks/useContextMenu";
import type { LibraryDocument } from "../../types/library";
import type { ReaderPageLayout, ReaderZoomMode } from "./readerView";

type ChromeIconName =
  | "actual"
  | "annotate"
  | "bookmark"
  | "book"
  | "close"
  | "cover"
  | "fit-height"
  | "fit-page"
  | "fit-visible"
  | "fit-width"
  | "fullscreen"
  | "highlight"
  | "next"
  | "page-single"
  | "page-spread"
  | "previous"
  | "reading"
  | "search"
  | "scroll"
  | "view";

type ChromeIconProps = {
  name: ChromeIconName;
  size?: number;
};

function ChromeIcon({ name, size = 18 }: ChromeIconProps) {
  const paths: Record<ChromeIconName, ReactNode> = {
    actual: (
      <>
        <path d="M6 3h9l3 3v15H6Z" />
        <path d="M15 3v4h4" />
        <path d="M9 11h2v6" />
        <path d="M14 13h2" />
      </>
    ),
    annotate: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
      </>
    ),
    bookmark: <path d="m19 21-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />,
    book: (
      <>
        <path d="M12 6.6C9.4 4.9 5.9 4.6 3.1 5.5v12.7c2.8-.9 6.3-.6 8.9 1.1 2.6-1.7 6.1-2 8.9-1.1V5.5C18 4.6 14.6 4.9 12 6.6Z" />
        <path d="M12 6.6v12.7" />
      </>
    ),
    close: (
      <>
        <path d="m18 6-12 12" />
        <path d="m6 6 12 12" />
      </>
    ),
    cover: (
      <>
        <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5Z" />
        <path d="M12 3h5.5A2.5 2.5 0 0 1 20 5.5v16a2.5 2.5 0 0 0-2.5-2.5H12" />
        <path d="M7.5 7h1" />
      </>
    ),
    "fit-height": (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="m10 8 2-2 2 2" />
        <path d="m10 16 2 2 2-2" />
      </>
    ),
    "fit-page": (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="m9 9-2-2" />
        <path d="m15 9 2-2" />
        <path d="m9 15-2 2" />
        <path d="m15 15 2 2" />
      </>
    ),
    "fit-visible": (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M8 10V8h2" />
        <path d="M14 8h2v2" />
        <path d="M16 14v2h-2" />
        <path d="M10 16H8v-2" />
      </>
    ),
    "fit-width": (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="m8 10-2 2 2 2" />
        <path d="m16 10 2 2-2 2" />
      </>
    ),
    highlight: (
      <>
        <path d="m15 5 4 4" />
        <path d="M14 6 4 16v4h4l10-10" />
        <path d="M13 20h7" />
      </>
    ),
    fullscreen: (
      <>
        <path d="M8 4H4v4" />
        <path d="M16 4h4v4" />
        <path d="M20 16v4h-4" />
        <path d="M8 20H4v-4" />
      </>
    ),
    "page-single": (
      <>
        <rect x="6" y="3" width="12" height="18" rx="2" />
        <path d="M9 7h6" />
      </>
    ),
    next: <path d="m9 18 6-6-6-6" />,
    "page-spread": (
      <>
        <rect x="3" y="4" width="8" height="16" rx="1.5" />
        <rect x="13" y="4" width="8" height="16" rx="1.5" />
      </>
    ),
    previous: <path d="m15 18-6-6 6-6" />,
    reading: (
      <>
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z" />
        <path d="M9 7h7" />
        <path d="M9 11h6" />
      </>
    ),
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    scroll: (
      <>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="m9 9 3-3 3 3" />
        <path d="m9 15 3 3 3-3" />
      </>
    ),
    view: (
      <>
        <rect x="3" y="4" width="8" height="16" rx="1.5" />
        <rect x="13" y="4" width="8" height="16" rx="1.5" />
        <path d="M6 8h2" />
        <path d="M16 8h2" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

type ReaderFloatingChromeProps = {
  document: Pick<LibraryDocument, "title" | "fileName" | "authors">;
  totalPages: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
  zoom: number;
  detailsOpen: boolean;
  readingMode: boolean;
  pageLayout: ReaderPageLayout;
  continuousScroll: boolean;
  showCover: boolean;
  zoomMode: ReaderZoomMode;
  nativeFullscreen: boolean;
  fullscreenTransitioning: boolean;
  visiblePageLabel: string;
  compact: boolean;
  draggable: boolean;
  onStartDragging: (event: MouseEvent<HTMLElement>) => void;
  onToggleDetails: () => void;
  onPreviousPage: () => void;
  onNextPage: () => void;
  onSearch: () => void;
  minZoom: number;
  maxZoom: number;
  zoomStep: number;
  onZoomChange: (zoom: number) => void;
  onSetPageLayout: (layout: ReaderPageLayout) => void;
  onToggleContinuousScroll: () => void;
  onToggleShowCover: () => void;
  onActualSize: () => void;
  onFitPage: () => void;
  onFitWidth: () => void;
  onFitHeight: () => void;
  onFitVisible: () => void;
  onToggleReadingMode: () => void;
  onToggleNativeFullscreen: () => void;
  onClose: () => void;
};

const chromeButtonClassName =
  "inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-muted hover:text-text-primary disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card";

export function ReaderFloatingChrome({
  document,
  totalPages,
  canGoPrevious,
  canGoNext,
  zoom,
  detailsOpen,
  readingMode,
  pageLayout,
  continuousScroll,
  showCover,
  zoomMode,
  nativeFullscreen,
  fullscreenTransitioning,
  visiblePageLabel,
  compact,
  draggable,
  onStartDragging,
  onToggleDetails,
  onPreviousPage,
  onNextPage,
  onSearch,
  minZoom,
  maxZoom,
  zoomStep,
  onZoomChange,
  onSetPageLayout,
  onToggleContinuousScroll,
  onToggleShowCover,
  onActualSize,
  onFitPage,
  onFitWidth,
  onFitHeight,
  onFitVisible,
  onToggleReadingMode,
  onToggleNativeFullscreen,
  onClose,
}: ReaderFloatingChromeProps) {
  const viewMenu = useContextMenu();
  const viewButtonRef = useRef<HTMLButtonElement>(null);
  const chromeRootRef = useRef<HTMLDivElement>(null);
  const zoomButtonRef = useRef<HTMLButtonElement>(null);
  const zoomPopoverRef = useRef<HTMLDivElement>(null);
  const sliderCommitTimerRef = useRef<number | null>(null);
  const pendingSliderZoomRef = useRef(zoom);
  const lastRequestedSliderZoomRef = useRef(zoom);
  const [isZoomPopoverOpen, setIsZoomPopoverOpen] = useState(false);
  const [sliderZoom, setSliderZoom] = useState(zoom);
  const documentTitle = document.title.trim() || document.fileName?.trim() || "Documento sem título";
  const authors = document.authors.filter((author) => author.trim().length > 0).join(" · ");
  const shadow = "var(--reader-floating-shadow)";
  const zoomProgress = ((sliderZoom - minZoom) / Math.max(1, maxZoom - minZoom)) * 100;
  const zoomSliderStyle = {
    "--reader-zoom-progress": `${Math.min(100, Math.max(0, zoomProgress))}%`,
  } as CSSProperties;

  useEffect(() => {
    chromeRootRef.current?.toggleAttribute("inert", readingMode);
  }, [readingMode]);

  useEffect(() => {
    pendingSliderZoomRef.current = zoom;
    lastRequestedSliderZoomRef.current = zoom;
    setSliderZoom(zoom);
  }, [zoom]);

  useEffect(() => {
    return () => {
      if (sliderCommitTimerRef.current !== null) {
        window.clearTimeout(sliderCommitTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isZoomPopoverOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !zoomPopoverRef.current?.contains(event.target)) {
        setIsZoomPopoverOpen(false);
      }
    }

    window.document.addEventListener("pointerdown", handlePointerDown);
    return () => window.document.removeEventListener("pointerdown", handlePointerDown);
  }, [isZoomPopoverOpen]);

  function selectMenuAction(action: () => void) {
    viewMenu.close();
    viewButtonRef.current?.focus({ preventScroll: true });
    action();
  }

  function openViewMenu() {
    setIsZoomPopoverOpen(false);
    const triggerRect = viewButtonRef.current?.getBoundingClientRect();

    if (triggerRect) {
      viewMenu.openAt(triggerRect.right - 286, triggerRect.bottom + 6);
    }
  }

  function toggleZoomPopover() {
    viewMenu.close();
    setIsZoomPopoverOpen((isOpen) => !isOpen);
  }

  function commitPendingSliderZoom() {
    if (sliderCommitTimerRef.current !== null) {
      window.clearTimeout(sliderCommitTimerRef.current);
      sliderCommitTimerRef.current = null;
    }
    const nextZoom = pendingSliderZoomRef.current;
    if (nextZoom === lastRequestedSliderZoomRef.current) {
      return;
    }
    lastRequestedSliderZoomRef.current = nextZoom;
    onZoomChange(nextZoom);
  }

  function queueSliderZoom(nextZoom: number) {
    pendingSliderZoomRef.current = nextZoom;
    setSliderZoom(nextZoom);
    if (sliderCommitTimerRef.current !== null) {
      window.clearTimeout(sliderCommitTimerRef.current);
    }
    sliderCommitTimerRef.current = window.setTimeout(commitPendingSliderZoom, 80);
  }

  function handleZoomPopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsZoomPopoverOpen(false);
    zoomButtonRef.current?.focus({ preventScroll: true });
  }

  return (
    <div
      ref={chromeRootRef}
      aria-hidden={readingMode}
      className={`reader-reading-island absolute inset-x-0 top-0 z-30 h-[84px] select-none bg-transparent ${
        readingMode ? "reader-reading-island--hidden reader-reading-island--top" : ""
      } ${draggable ? "cursor-move" : ""}`}
      onMouseDown={draggable ? onStartDragging : undefined}
    >
      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-label={detailsOpen ? "Ocultar detalhes do documento" : "Abrir detalhes do documento"}
        title={detailsOpen ? "Ocultar detalhes" : "Abrir detalhes"}
        className={`absolute left-[22px] top-5 flex items-center gap-2.5 rounded-[13px] border px-3.5 text-left shadow-none transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-app ${
          compact ? "h-11 w-[214px]" : "min-h-[50px] w-[306px] py-2"
        } ${
          detailsOpen
            ? "border-primary bg-primary-soft"
            : "border-border-subtle bg-surface-card hover:bg-surface-muted"
        }`}
        style={{ boxShadow: shadow }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={onToggleDetails}
      >
        <span className="shrink-0 text-primary">
          <ChromeIcon name="book" size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-serif text-[13.5px] font-bold leading-tight text-text-primary" title={documentTitle}>
            {documentTitle}
          </span>
          {!compact && authors ? (
            <span className="mt-0.5 block truncate text-[11px] leading-tight text-text-secondary" title={authors}>
              {authors}
            </span>
          ) : null}
        </span>
      </button>

      <div
        className={`absolute right-[22px] top-5 flex h-[44px] items-center rounded-[13px] border border-border-subtle bg-surface-card py-1.5 ${
          compact ? "gap-0.5 px-1" : "gap-1.5 px-2"
        }`}
        style={{ boxShadow: shadow }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Página anterior"
          title="Página anterior"
          className={chromeButtonClassName}
          disabled={!canGoPrevious}
          onClick={onPreviousPage}
        >
          <ChromeIcon name="previous" size={15} />
        </button>
        <output
          aria-label={`Página ${visiblePageLabel} de ${totalPages}`}
          className={`whitespace-nowrap text-center text-[12.5px] font-semibold tabular-nums text-text-primary ${compact ? "min-w-[44px]" : "min-w-[54px]"}`}
        >
          {visiblePageLabel} / {totalPages}
        </output>
        <button
          type="button"
          aria-label="Próxima página"
          title="Próxima página"
          className={chromeButtonClassName}
          disabled={!canGoNext}
          onClick={onNextPage}
        >
          <ChromeIcon name="next" size={15} />
        </button>

        <span
          aria-hidden="true"
          className="mx-0.5 h-[18px] w-px"
          style={{ backgroundColor: "var(--reader-chrome-divider)" }}
        />
        <div ref={zoomPopoverRef} className="relative flex items-center" onKeyDown={handleZoomPopoverKeyDown}>
          <button
            ref={zoomButtonRef}
            type="button"
            aria-label={`Ajustar zoom. Zoom atual em ${Math.round(zoom)}%`}
            title="Ajustar zoom"
            aria-haspopup="dialog"
            aria-expanded={isZoomPopoverOpen}
            className={`min-w-[48px] rounded-lg border px-1.5 py-1 text-[12.5px] font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card ${
              isZoomPopoverOpen
                ? "border-primary bg-primary-soft text-text-primary"
                : "border-transparent text-text-secondary hover:bg-surface-muted hover:text-text-primary"
            }`}
            onClick={toggleZoomPopover}
          >
            {Math.round(zoom)}%
          </button>

          {isZoomPopoverOpen ? (
            <div
              role="dialog"
              aria-label="Ajustar zoom do documento"
              className="absolute left-1/2 top-[calc(100%+12px)] z-40 flex h-[54px] w-[274px] -translate-x-1/2 items-center gap-2 rounded-[11px] border border-border-subtle bg-surface-card px-2.5 text-text-secondary"
              style={{ boxShadow: shadow }}
            >
              <button
                type="button"
                aria-label="Reduzir zoom"
                title="Reduzir zoom (Ctrl + -)"
                disabled={zoom <= minZoom}
                className={chromeButtonClassName}
                onClick={() => onZoomChange(zoom - zoomStep)}
              >
                <span aria-hidden="true" className="text-lg leading-none">−</span>
              </button>
              <input
                type="range"
                min={minZoom}
                max={maxZoom}
                step={1}
                value={sliderZoom}
                aria-label="Nível de zoom"
                aria-valuetext={`${Math.round(sliderZoom)}%`}
                className="reader-zoom-slider min-w-0 flex-1"
                style={zoomSliderStyle}
                onChange={(event) => queueSliderZoom(Number(event.target.value))}
                onBlur={commitPendingSliderZoom}
                onKeyUp={commitPendingSliderZoom}
                onPointerUp={commitPendingSliderZoom}
                onPointerCancel={commitPendingSliderZoom}
              />
              <button
                type="button"
                aria-label="Aumentar zoom"
                title="Aumentar zoom (Ctrl + +)"
                disabled={zoom >= maxZoom}
                className={chromeButtonClassName}
                onClick={() => onZoomChange(zoom + zoomStep)}
              >
                <span aria-hidden="true" className="text-lg leading-none">+</span>
              </button>
              <output className="w-[42px] shrink-0 text-right text-[12px] font-semibold tabular-nums text-text-primary">
                {Math.round(sliderZoom)}%
              </output>
            </div>
          ) : null}
        </div>

        <button
          ref={viewButtonRef}
          type="button"
          aria-label="Opções de visualização"
          title="Visualização"
          aria-haspopup="menu"
          aria-expanded={viewMenu.isOpen}
          className={`${chromeButtonClassName} ${viewMenu.isOpen ? "bg-primary-soft text-primary" : ""}`}
          onClick={openViewMenu}
        >
          <ChromeIcon name="view" size={18} />
        </button>

        <span
          aria-hidden="true"
          className="mx-0.5 h-[18px] w-px"
          style={{ backgroundColor: "var(--reader-chrome-divider)" }}
        />
        <button
          type="button"
          aria-label="Buscar no documento"
          title="Buscar no documento (Ctrl+F)"
          className={chromeButtonClassName}
          onClick={onSearch}
        >
          <ChromeIcon name="search" size={17} />
        </button>
        <button
          type="button"
          aria-label="Fechar leitor"
          title="Fechar leitor"
          className={chromeButtonClassName}
          onClick={onClose}
        >
          <ChromeIcon name="close" size={17} />
        </button>
      </div>

      <ContextMenu
        isOpen={viewMenu.isOpen}
        x={viewMenu.x}
        y={viewMenu.y}
        autoFocus
        width={286}
        maxHeight={Math.min(460, Math.max(320, window.innerHeight - 84))}
        onClose={() => {
          viewMenu.close();
          viewButtonRef.current?.focus({ preventScroll: true });
        }}
      >
        <div role="group" aria-label="Layout das páginas">
          <ContextMenuItem
            checked={pageLayout === "single"}
            selectionMode="radio"
            icon={<ChromeIcon name="page-single" size={17} />}
            label="Exibição em uma página"
            onSelect={() => selectMenuAction(() => onSetPageLayout("single"))}
          />
          <ContextMenuItem
            checked={pageLayout === "spread"}
            selectionMode="radio"
            icon={<ChromeIcon name="page-spread" size={17} />}
            label="Exibição em duas páginas"
            onSelect={() => selectMenuAction(() => onSetPageLayout("spread"))}
          />
        </div>
        <ContextMenuItem
          checked={pageLayout === "spread" && showCover}
          icon={<ChromeIcon name="cover" size={17} />}
          label="Mostrar capa"
          disabled={pageLayout !== "spread"}
          onSelect={() => selectMenuAction(onToggleShowCover)}
        />
        <ContextMenuItem
          checked={continuousScroll}
          icon={<ChromeIcon name="scroll" size={17} />}
          label="Rolagem contínua"
          onSelect={() => selectMenuAction(onToggleContinuousScroll)}
        />
        <ContextMenuDivider />
        <div role="group" aria-label="Ajuste de zoom">
          <ContextMenuItem
            checked={zoomMode === "actual"}
            selectionMode="radio"
            icon={<ChromeIcon name="actual" size={17} />}
            label="Tamanho real"
            onSelect={() => selectMenuAction(onActualSize)}
          />
          <ContextMenuItem
            checked={zoomMode === "page"}
            selectionMode="radio"
            icon={<ChromeIcon name="fit-page" size={17} />}
            label="Ajustar à página"
            onSelect={() => selectMenuAction(onFitPage)}
          />
          <ContextMenuItem
            checked={zoomMode === "width"}
            selectionMode="radio"
            icon={<ChromeIcon name="fit-width" size={17} />}
            label="Ajustar à largura"
            onSelect={() => selectMenuAction(onFitWidth)}
          />
          <ContextMenuItem
            checked={zoomMode === "height"}
            selectionMode="radio"
            icon={<ChromeIcon name="fit-height" size={17} />}
            label="Ajustar à altura"
            onSelect={() => selectMenuAction(onFitHeight)}
          />
          <ContextMenuItem
            checked={zoomMode === "visible"}
            selectionMode="radio"
            icon={<ChromeIcon name="fit-visible" size={17} />}
            label="Ajustar conteúdo visível"
            onSelect={() => selectMenuAction(onFitVisible)}
          />
        </div>
        <ContextMenuDivider />
        <ContextMenuItem
          checked={readingMode}
          icon={<ChromeIcon name="reading" size={17} />}
          label="Modo de leitura"
          onSelect={() => selectMenuAction(onToggleReadingMode)}
        />
        <ContextMenuItem
          checked={nativeFullscreen}
          icon={<ChromeIcon name="fullscreen" size={17} />}
          label={nativeFullscreen ? "Sair da tela cheia" : "Tela cheia"}
          disabled={fullscreenTransitioning}
          onSelect={() => selectMenuAction(onToggleNativeFullscreen)}
        />
      </ContextMenu>
    </div>
  );
}

type ReaderToolRailProps = {
  hasSelection: boolean;
  right: number;
  readingMode: boolean;
  onHighlight: () => void;
  onAnnotate: () => void;
};

const toolButtonClassName =
  "inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card disabled:cursor-not-allowed disabled:opacity-40";

export function ReaderToolRail({ hasSelection, right, readingMode, onHighlight, onAnnotate }: ReaderToolRailProps) {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    railRef.current?.toggleAttribute("inert", readingMode);
  }, [readingMode]);

  return (
    <div
      ref={railRef}
      role="toolbar"
      aria-label="Ferramentas de seleção"
      aria-hidden={readingMode}
      className={`reader-reading-island absolute top-[116px] z-20 flex flex-col gap-[3px] rounded-[13px] border border-border-subtle bg-surface-card p-1.5 text-text-secondary ${
        readingMode ? "reader-reading-island--hidden reader-reading-island--right" : ""
      }`}
      style={{
        right,
        boxShadow: "var(--reader-floating-shadow)",
      }}
    >
      <button
        type="button"
        disabled={!hasSelection}
        aria-disabled={!hasSelection}
        aria-label="Marca-texto"
        title={hasSelection ? "Marca-texto" : "Selecione um trecho para destacar."}
        className={`${toolButtonClassName} bg-highlight-amber text-highlight-amber-text enabled:hover:brightness-95`}
        onClick={onHighlight}
      >
        <ChromeIcon name="highlight" size={19} />
      </button>
      <button
        type="button"
        disabled={!hasSelection}
        aria-disabled={!hasSelection}
        aria-label="Anotar"
        title={hasSelection ? "Anotar" : "Selecione um trecho para anotar."}
        className={`${toolButtonClassName} enabled:hover:bg-surface-muted enabled:hover:text-text-primary`}
        onClick={onAnnotate}
      >
        <ChromeIcon name="annotate" />
      </button>
      <button
        type="button"
        disabled
        aria-disabled="true"
        aria-label="Marcador indisponível"
        title="Marcadores estarão disponíveis em uma próxima entrega."
        className={toolButtonClassName}
      >
        <ChromeIcon name="bookmark" />
      </button>
    </div>
  );
}
