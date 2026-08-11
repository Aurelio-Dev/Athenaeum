import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { floatingPanelId, useFloatingPanels } from "../../components/floating/FloatingPanelsContext";
import type { LibraryDocument, ReadingLocation } from "../../types/library";
import { ReaderContent, type ReaderContentSize } from "../reader/ReaderContent";

type ReaderPanelGeometry = {
  position: { x: number; y: number };
  size: ReaderContentSize;
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

const readerMinWidth = 720;
const readerMinHeight = 480;

function getAnnotationsPanelInitialPosition() {
  const panelWidth = 440;
  const panelHeight = 580;
  return {
    x: Math.max(8, window.innerWidth - panelWidth - 24),
    y: Math.max(76, Math.min(94, window.innerHeight - panelHeight)),
  };
}

function getMaximizedReaderSize(): ReaderContentSize {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

// Tamanho padrao do leitor restaurado (espelha getReaderInitialPosition do
// LibraryView). Tambem e o fallback ao restaurar um leitor que abriu
// maximizado e nunca teve tamanho/posicao proprios.
function getDefaultReaderSize(): ReaderContentSize {
  return clampReaderSizeToViewport({
    width: Math.max(readerMinWidth, Math.min(1240, window.innerWidth - 64)),
    height: Math.max(readerMinHeight, Math.min(900, window.innerHeight - 96)),
  });
}

function clampReaderSizeToViewport(size: ReaderContentSize): ReaderContentSize {
  const viewportWidth = Math.max(1, window.innerWidth);
  const viewportHeight = Math.max(1, window.innerHeight);
  return {
    width: Math.min(viewportWidth, Math.max(Math.min(readerMinWidth, viewportWidth), size.width)),
    height: Math.min(viewportHeight, Math.max(Math.min(readerMinHeight, viewportHeight), size.height)),
  };
}

function clampReaderPositionToViewport(
  position: { x: number; y: number },
  size: ReaderContentSize,
) {
  return {
    x: Math.max(0, Math.min(position.x, window.innerWidth - Math.min(size.width, window.innerWidth))),
    y: Math.max(0, Math.min(position.y, window.innerHeight - Math.min(size.height, window.innerHeight))),
  };
}

function getDefaultReaderPosition(size: ReaderContentSize) {
  return {
    x: Math.max(0, Math.round((window.innerWidth - size.width) / 2)),
    y: Math.max(0, Math.min(84, window.innerHeight - size.height)),
  };
}

export function ReaderModal({
  document,
  initialMaximized,
  onClose,
  onSaveNotes,
  onNotesReloaded,
  onToggleFavorite,
}: ReaderModalProps) {
  const {
    panels: floatingPanels,
    openPanel,
    closePanel,
    minimizePanel,
    restorePanel,
    movePanel,
  } = useFloatingPanels();
  const readerPanelId = floatingPanelId("reader", document.id);
  const annotationsPanelId = floatingPanelId("annotations", document.id);
  const readerPanel = floatingPanels.find((panel) => panel.id === readerPanelId) ?? null;
  const annotationsPanel = floatingPanels.find((panel) => panel.id === annotationsPanelId) ?? null;
  const [readerPanelSize, setReaderPanelSize] = useState<ReaderContentSize>(() =>
    initialMaximized ? getMaximizedReaderSize() : getDefaultReaderSize(),
  );
  const isReaderMaximized = initialMaximized;
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const nativeFullscreenRestoreStateRef = useRef<ReaderPanelGeometry | null>(null);
  const panelCleanupTimerRef = useRef<number | null>(null);

  const isActiveForShortcuts = useMemo(() => {
    const topPanel = [...floatingPanels].reverse().find((panel) => !panel.isMinimized);
    return !topPanel || topPanel.id === readerPanelId;
  }, [floatingPanels, readerPanelId]);
  const isAnnotationsPanelActiveForShortcuts =
    floatingPanels[floatingPanels.length - 1]?.id === annotationsPanelId &&
    annotationsPanel?.isMinimized === false;

  // A moldura continua dona da geometria usada para entrar/sair da tela cheia.
  // O conteudo apenas informa a mudanca visual da janela.
  const handleNativeFullscreenVisualStateChange = useCallback(
    (fullscreen: boolean) => {
      setIsNativeFullscreen(fullscreen);

      if (fullscreen) {
        if (!isReaderMaximized && readerPanel) {
          nativeFullscreenRestoreStateRef.current = {
            position: readerPanel.position,
            size: readerPanelSize,
          };
        }
        setReaderPanelSize(getMaximizedReaderSize());
        movePanel(readerPanelId, { x: 0, y: 0 });
        return;
      }

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

  useEffect(() => {
    if (panelCleanupTimerRef.current !== null) {
      window.clearTimeout(panelCleanupTimerRef.current);
      panelCleanupTimerRef.current = null;
    }

    return () => {
      // O React.StrictMode repete setup/cleanup/setup na primeira montagem em
      // desenvolvimento. Adiar um tick permite que o setup seguinte cancele o
      // falso unmount; no unmount real nao ha novo setup e os paineis fecham.
      panelCleanupTimerRef.current = window.setTimeout(() => {
        panelCleanupTimerRef.current = null;
        closePanel(annotationsPanelId);
        closePanel(readerPanelId);
      }, 0);
    };
  }, [annotationsPanelId, closePanel, readerPanelId]);

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

  return (
    <ReaderContent
      document={document}
      onClose={onClose}
      onSaveNotes={onSaveNotes}
      onNotesReloaded={onNotesReloaded}
      onToggleFavorite={onToggleFavorite}
      readerPanelSize={readerPanelSize}
      isReaderMaximized={isReaderMaximized}
      isActiveForShortcuts={isActiveForShortcuts}
      annotationsPanel={annotationsPanel}
      isAnnotationsPanelActiveForShortcuts={isAnnotationsPanelActiveForShortcuts}
      onOpenAnnotationsPanel={() =>
        openPanel("annotations", document.id, getAnnotationsPanelInitialPosition())
      }
      onCloseAnnotationsPanel={() => closePanel(annotationsPanelId)}
      onMinimizeAnnotationsPanel={() => minimizePanel(annotationsPanelId)}
      onRestoreAnnotationsPanel={() => restorePanel(annotationsPanelId)}
      onNativeFullscreenVisualStateChange={handleNativeFullscreenVisualStateChange}
    >
      {({ renderHeader, body, effectiveNativeFullscreen }) => {
        // Mantem o conteudo montado durante o estado transitorio em que a
        // entrada da pilha ainda nao existe, como o ReaderModal fazia antes.
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
              if (annotationsPanel) {
                minimizePanel(annotationsPanelId);
              }
            }}
            renderHeader={(startDragging) =>
              renderHeader(
                !isReaderMaximized && !effectiveNativeFullscreen
                  ? startDragging
                  : undefined,
              )
            }
          >
            {body}
          </FloatingPanelFrame>
        );
      }}
    </ReaderContent>
  );
}
