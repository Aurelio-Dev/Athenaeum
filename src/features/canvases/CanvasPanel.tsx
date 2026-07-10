import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Layer, Shape, Stage } from "react-konva";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { canvasPanelHeight, canvasPanelMinHeight, canvasPanelMinWidth, canvasPanelWidth } from "./canvasPanelDimensions";

const collapsedHeight = 42;
const headerHeight = 40;
const gridSpacing = 20;
const gridDotRadius = 1.25;
const gridColor = "#D4C4B5";
const canvasBackground = "#F0E8DF";
const zoomStep = 1.08;
const minimumZoom = 0.25;
const maximumZoom = 4;

function getMaximizedPanelSize() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function getInitialPanelSize() {
  return {
    width: Math.min(canvasPanelWidth, window.innerWidth),
    height: Math.min(canvasPanelHeight, window.innerHeight),
  };
}

function clampZoom(scale: number) {
  return Math.min(maximumZoom, Math.max(minimumZoom, scale));
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.isContentEditable || target.matches("input, textarea, select");
}

function CanvasGrid() {
  return (
    <Shape
      listening={false}
      perfectDrawEnabled={false}
      sceneFunc={(context, shape) => {
        const stage = shape.getStage();
        if (!stage) {
          return;
        }

        const scale = stage.scaleX() || 1;
        const left = -stage.x() / scale;
        const top = -stage.y() / scale;
        const right = (stage.width() - stage.x()) / scale;
        const bottom = (stage.height() - stage.y()) / scale;
        const startX = Math.floor(left / gridSpacing) * gridSpacing;
        const startY = Math.floor(top / gridSpacing) * gridSpacing;
        const radius = gridDotRadius / scale;

        context.beginPath();

        for (let x = startX; x <= right + gridSpacing; x += gridSpacing) {
          for (let y = startY; y <= bottom + gridSpacing; y += gridSpacing) {
            context.moveTo(x + radius, y);
            context.arc(x, y, radius, 0, Math.PI * 2);
          }
        }

        context.fillStyle = gridColor;
        context.fill();
      }}
    />
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <line x1="18" x2="6" y1="6" y2="18" />
      <line x1="6" x2="18" y1="6" y2="18" />
    </svg>
  );
}

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

function CanvasHeaderIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="5" width="16" height="14" rx="1.5" />
      <path d="M8 9h8" />
      <path d="M8 13h5" />
    </svg>
  );
}

type CanvasPanelProps = {
  panel: FloatingPanel;
  title: string;
  onClose: () => void;
  // Mantido no contrato para a proxima fase de persistencia do Quadro.
  onCanvasChanged: () => void;
};

export function CanvasPanel({ panel, title, onClose }: CanvasPanelProps) {
  const { movePanel } = useFloatingPanels();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [panelSize, setPanelSize] = useState(getInitialPanelSize);
  const [stageSize, setStageSize] = useState(() => {
    const initialPanelSize = getInitialPanelSize();
    return { width: initialPanelSize.width, height: initialPanelSize.height - headerHeight };
  });
  const [isMaximized, setIsMaximized] = useState(false);
  const restoreStateRef = useRef<{
    position: { x: number; y: number };
    size: { width: number; height: number };
    collapsed: boolean;
  } | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const pointerInsideRef = useRef(false);
  const spacePressedRef = useRef(false);
  const isPanningRef = useRef(false);

  const setCanvasCursor = useCallback((cursor: "default" | "grab" | "grabbing") => {
    if (canvasContainerRef.current) {
      canvasContainerRef.current.style.cursor = cursor;
    }
  }, []);

  const syncStageSize = useCallback(() => {
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }

    const width = Math.max(1, Math.round(container.clientWidth));
    const height = Math.max(1, Math.round(container.clientHeight));

    setStageSize((current) => (current.width === width && current.height === height ? current : { width, height }));

    const stage = stageRef.current;
    if (stage) {
      stage.size({ width, height });
      stage.batchDraw();
    }
  }, []);

  const refreshStageSoon = useCallback(() => {
    window.requestAnimationFrame(syncStageSize);
  }, [syncStageSize]);

  useLayoutEffect(() => {
    if (isCollapsed) {
      return;
    }

    syncStageSize();
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }

    const resizeObserver = new ResizeObserver(syncStageSize);
    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isCollapsed, syncStageSize]);

  const finishPan = useCallback(() => {
    const stage = stageRef.current;
    isPanningRef.current = false;

    if (stage?.isDragging()) {
      stage.stopDrag();
    }
    stage?.draggable(false);
    stage?.batchDraw();
    setCanvasCursor(spacePressedRef.current && pointerInsideRef.current ? "grab" : "default");
  }, [setCanvasCursor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || !pointerInsideRef.current || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      spacePressedRef.current = true;
      setCanvasCursor(isPanningRef.current ? "grabbing" : "grab");
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space" || !spacePressedRef.current) {
        return;
      }

      event.preventDefault();
      spacePressedRef.current = false;
      setCanvasCursor(isPanningRef.current ? "grabbing" : "default");
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", finishPan);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", finishPan);
      finishPan();
    };
  }, [finishPan, setCanvasCursor]);

  const handleWheel = useCallback((event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = event.target.getStage();
    const pointer = stage?.getPointerPosition();
    if (!stage || !pointer) {
      return;
    }

    const oldScale = stage.scaleX();
    const pointInCanvas = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    let direction = event.evt.deltaY > 0 ? -1 : 1;

    // Trackpads sinalizam o gesto de pinca com ctrlKey e delta invertido.
    if (event.evt.ctrlKey) {
      direction *= -1;
    }

    const newScale = clampZoom(direction > 0 ? oldScale * zoomStep : oldScale / zoomStep);
    stage.scale({ x: newScale, y: newScale });
    stage.position({
      x: pointer.x - pointInCanvas.x * newScale,
      y: pointer.y - pointInCanvas.y * newScale,
    });
    stage.batchDraw();
  }, []);

  const handlePanStart = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    const canPanWithMiddleButton = event.evt.button === 1;
    const canPanWithSpace = event.evt.button === 0 && spacePressedRef.current;
    if (!canPanWithMiddleButton && !canPanWithSpace) {
      return;
    }

    event.evt.preventDefault();
    const stage = event.target.getStage();
    if (!stage) {
      return;
    }

    isPanningRef.current = true;
    setCanvasCursor("grabbing");
    stage.draggable(true);
    stage.startDrag(event.evt);
  }, [setCanvasCursor]);

  const toggleCollapsed = useCallback(() => {
    setIsCollapsed((current) => !current);
    refreshStageSoon();
  }, [refreshStageSoon]);

  const toggleMaximized = useCallback(() => {
    if (isMaximized) {
      const restoreState = restoreStateRef.current;

      if (restoreState) {
        setPanelSize(restoreState.size);
        setIsCollapsed(restoreState.collapsed);
        movePanel(panel.id, restoreState.position);
      }

      setIsMaximized(false);
      refreshStageSoon();
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
    refreshStageSoon();
  }, [isCollapsed, isMaximized, movePanel, panel.id, panel.position, panelSize, refreshStageSoon]);

  useEffect(() => {
    if (!isMaximized) {
      return;
    }

    function handleWindowResize() {
      setPanelSize(getMaximizedPanelSize());
      movePanel(panel.id, { x: 0, y: 0 });
      refreshStageSoon();
    }

    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [isMaximized, movePanel, panel.id, refreshStageSoon]);

  return (
    <FloatingPanelFrame
      panel={panel}
      width={panelSize.width}
      height={isCollapsed ? collapsedHeight : panelSize.height}
      minWidth={canvasPanelMinWidth}
      minHeight={isCollapsed ? collapsedHeight : canvasPanelMinHeight}
      resizable={!isCollapsed && !isMaximized}
      edgeToEdge={isMaximized}
      onMoveEnd={refreshStageSoon}
      onResize={(size) => {
        setPanelSize(size);
        refreshStageSoon();
      }}
      renderHeader={(startDragging) => (
        <div
          className={`flex h-10 shrink-0 items-center justify-between border-b border-[var(--floating-header-border)] bg-[var(--floating-header-bg)] px-4 ${
            isMaximized ? "" : "cursor-move"
          }`}
          onMouseDown={isMaximized ? undefined : startDragging}
        >
          <h2 className="flex min-w-0 items-center gap-2 text-sm font-bold text-[var(--floating-header-text)]">
            <span className="shrink-0 text-[var(--floating-header-muted)]">
              <CanvasHeaderIcon />
            </span>
            <span className="truncate">{title || "Quadro"}</span>
          </h2>
          <div className="flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
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
            <button
              type="button"
              aria-label="Fechar painel"
              title="Fechar painel"
              className="rounded-md p-1.5 text-[var(--floating-header-control)] transition hover:bg-[var(--floating-header-hover-bg)] hover:text-[var(--floating-header-text)]"
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      )}
    >
      {isCollapsed ? null : (
        <div
          ref={canvasContainerRef}
          className="min-h-0 flex-1 overflow-hidden"
          style={{ backgroundColor: canvasBackground }}
          onPointerEnter={() => {
            pointerInsideRef.current = true;
            setCanvasCursor(spacePressedRef.current ? "grab" : "default");
          }}
          onPointerLeave={() => {
            pointerInsideRef.current = false;
            if (!isPanningRef.current) {
              setCanvasCursor("default");
            }
          }}
        >
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            role="application"
            title="Quadro: use a roda do mouse para zoom e arraste com o botao do meio ou Espaco"
            onWheel={handleWheel}
            onMouseDown={handlePanStart}
            onMouseUp={finishPan}
            onDragEnd={finishPan}
          >
            <Layer>
              <CanvasGrid />
            </Layer>
          </Stage>
        </div>
      )}
    </FloatingPanelFrame>
  );
}
