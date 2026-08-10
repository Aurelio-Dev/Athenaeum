import { useCallback, useEffect, useRef, useState } from "react";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import type { LibraryCollection, LibraryDocument, SubjectTag } from "../../types/library";
import { NotebookContent } from "./NotebookContent";
import {
  notebookPanelHeight,
  notebookPanelMinHeight,
  notebookPanelMinWidth,
  notebookPanelWidth,
} from "./notebookPanelDimensions";

// Altura do header do frame (h-10) + bordas: o painel minimizado vira so a
// barra de titulo arrastavel.
const collapsedHeight = 42;

// Mesmos icones/botoes de moldura dos outros paineis flutuantes (ver
// CanvasPanel): minimizar/maximizar sao controles de MOLDURA, entao vivem
// aqui e entram no header do conteudo como um no pronto (frameHeaderActions).
function MinimizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <line x1="6" x2="18" y1="12" y2="12" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4H4v4" />
      <path d="M16 4h4v4" />
      <path d="M20 16v4h-4" />
      <path d="M8 20H4v-4" />
    </svg>
  );
}

function RestoreIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 4h12v12" />
      <path d="M4 8h12v12H4z" />
    </svg>
  );
}

function getMaximizedPanelSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getInitialPanelSize() {
  return {
    width: Math.min(notebookPanelWidth, window.innerWidth),
    height: Math.min(notebookPanelHeight, window.innerHeight),
  };
}

type NotebookPanelProps = {
  panel: FloatingPanel;
  collections: LibraryCollection[];
  // Biblioteca inteira (para o seletor de "Attach another PDF") e o vocabulario
  // de tags — ambos ja carregados pelo LibraryView, passados por prop para nao
  // refazer a query aqui dentro.
  documents: LibraryDocument[];
  availableTags: SubjectTag[];
  onAvailableTagsChange: (tags: SubjectTag[]) => void;
  onClose: () => void;
  initialMaximized?: boolean;
  // Avisa a listagem (contagem de paginas / "Editado ha X") apos cada save.
  onNotebookChanged: () => void;
  onNotebookMovedToTrash?: () => void;
};

// Moldura do Caderno na pilha de paineis flutuantes: e o UNICO lado que conhece
// o FloatingPanelsContext. Dados, editor e drawer vivem no NotebookContent —
// que tambem renderiza o header (o status de salvamento e os botoes de "i"/
// opcoes sao estado de conteudo), recebendo daqui os botoes de moldura ja
// prontos (frameHeaderActions) e o sinal de "ativo para atalhos".
export function NotebookPanel({
  panel,
  collections,
  documents,
  availableTags,
  onAvailableTagsChange,
  onClose,
  initialMaximized = false,
  onNotebookChanged,
  onNotebookMovedToTrash,
}: NotebookPanelProps) {
  const notebookId = Number(panel.entityId);
  const { panels, movePanel } = useFloatingPanels();

  const [isCollapsed, setIsCollapsed] = useState(false);
  const initialPanelSizeRef = useRef(getInitialPanelSize());
  const [panelSize, setPanelSize] = useState(() => (initialMaximized ? getMaximizedPanelSize() : initialPanelSizeRef.current));
  const [isMaximized, setIsMaximized] = useState(initialMaximized);
  const restoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    collapsed: boolean;
  } | null>(initialMaximized ? { position: panel.position, size: initialPanelSizeRef.current, collapsed: false } : null);
  const hasAppliedInitialMaximizedRef = useRef(initialMaximized);

  // Atalhos de janela (Ctrl+S/Esc) valem so para o painel do topo da pilha; o
  // NotebookContent recebe o veredito pronto para nao depender do contexto.
  const isActiveForShortcuts = panels[panels.length - 1]?.id === panel.id;

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((current) => !current);
  }, []);

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      const restoreState = restoreStateRef.current;

      if (restoreState) {
        setPanelSize(restoreState.size);
        setIsCollapsed(restoreState.collapsed);
        movePanel(panel.id, restoreState.position);
      }

      setIsMaximized(false);
      return;
    }

    restoreStateRef.current = {
      position: panel.position,
      size: panelSize,
      collapsed: isCollapsed,
    };
    setIsCollapsed(false);
    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });
    setIsMaximized(true);
  }, [isCollapsed, isMaximized, movePanel, panel.id, panel.position, panelSize]);

  useEffect(() => {
    if (!initialMaximized || hasAppliedInitialMaximizedRef.current) {
      return;
    }

    restoreStateRef.current = {
      position: panel.position,
      size: panelSize,
      collapsed: isCollapsed,
    };
    hasAppliedInitialMaximizedRef.current = true;
    setIsCollapsed(false);
    setIsMaximized(true);
  }, [initialMaximized, isCollapsed, panel.position, panelSize]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }

    setPanelSize(getMaximizedPanelSize());
    movePanel(panel.id, { x: 0, y: 0 });

    function handleWindowResize() {
      setPanelSize(getMaximizedPanelSize());
      movePanel(panel.id, { x: 0, y: 0 });
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, movePanel, panel.id]);

  return (
    <NotebookContent
      notebookId={notebookId}
      collections={collections}
      documents={documents}
      availableTags={availableTags}
      onAvailableTagsChange={onAvailableTagsChange}
      onClose={onClose}
      onNotebookChanged={onNotebookChanged}
      onNotebookMovedToTrash={onNotebookMovedToTrash}
      isActiveForShortcuts={isActiveForShortcuts}
      isCollapsed={isCollapsed}
      frameHeaderActions={
        <>
          <button
            type="button"
            aria-label={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
            title={isCollapsed ? "Restaurar painel" : "Minimizar painel"}
            className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
            onClick={toggleCollapsed}
          >
            <MinimizeIcon />
          </button>
          <button
            type="button"
            aria-label={isMaximized ? "Restaurar painel" : "Maximizar painel"}
            title={isMaximized ? "Restaurar painel" : "Maximizar painel"}
            className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
            onClick={toggleMaximized}
          >
            {isMaximized ? <RestoreIcon /> : <MaximizeIcon />}
          </button>
        </>
      }
    >
      {({ renderHeader, body }) => (
        <FloatingPanelFrame
          panel={panel}
          width={panelSize.width}
          height={isCollapsed ? collapsedHeight : panelSize.height}
          minWidth={notebookPanelMinWidth}
          minHeight={isCollapsed ? collapsedHeight : notebookPanelMinHeight}
          resizable={!isCollapsed && !isMaximized}
          edgeToEdge={isMaximized}
          onResize={setPanelSize}
          // Maximizado nao arrasta: sem startDragging o header do conteudo nem
          // liga o handler (e apaga o cursor-move).
          renderHeader={(startDragging) => renderHeader(isMaximized ? undefined : startDragging)}
        >
          {body}
        </FloatingPanelFrame>
      )}
    </NotebookContent>
  );
}
