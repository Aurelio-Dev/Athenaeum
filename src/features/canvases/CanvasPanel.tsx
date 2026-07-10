import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Layer, Rect, Shape, Stage } from "react-konva";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { getCanvasContent, saveCanvasContent } from "../../lib/database";
import { useReaderPersistence } from "../reader/useReaderPersistence";
import { parseCanvasContent, type CanvasSceneContent, type CanvasShape } from "./canvasScene";
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

// Ferramentas temporarias da Fase 2 (ver comentario no componente): "select"
// para escolher/mover e "rect" para desenhar retangulos.
type CanvasMode = "select" | "rect";
// Retangulo em construcao durante o arrasto no modo "rect".
type DraftRect = { x: number; y: number; width: number; height: number };

const shapeDefaultStroke = "#2C1A10";
const shapeDefaultStrokeWidth = 2;
// Realce visual (apenas em runtime) da forma selecionada — nao altera o stroke
// persistido da forma.
const selectionStroke = "#B0592B";
// Abaixo disso trata-se de um clique sem arrasto: nao cria retangulo degenerado.
const minShapeSize = 3;

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

function createShapeId(): string {
  // randomUUID existe no WebView do Tauri; fallback defensivo por seguranca.
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `shape-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Converte a posicao do ponteiro (coordenadas de tela do stage) para as
// coordenadas do "mundo" do Quadro, desfazendo pan e zoom do stage.
function toCanvasPoint(stage: Konva.Stage): { x: number; y: number } | null {
  const pointer = stage.getPointerPosition();
  if (!pointer) {
    return null;
  }

  const scale = stage.scaleX() || 1;
  return {
    x: (pointer.x - stage.x()) / scale,
    y: (pointer.y - stage.y()) / scale,
  };
}

// Normaliza um retangulo definido por dois pontos para ter largura/altura
// positivas (o usuario pode arrastar em qualquer direcao).
function normalizeDraft(start: { x: number; y: number }, current: { x: number; y: number }): DraftRect {
  return {
    x: Math.min(start.x, current.x),
    y: Math.min(start.y, current.y),
    width: Math.abs(current.x - start.x),
    height: Math.abs(current.y - start.y),
  };
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
  // Invalida a lista de quadros para o card refletir o "Editado ha X" apos salvar.
  onCanvasChanged: () => void;
};

export function CanvasPanel({ panel, title, onClose, onCanvasChanged }: CanvasPanelProps) {
  const { movePanel } = useFloatingPanels();
  // O id do quadro vem do entityId do painel (`${type}-${entityId}`), que e o
  // String(canvas.id) usado ao abrir o painel.
  const canvasId = Number(panel.entityId);
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

  // INTERACAO TEMPORARIA (Fase 2): dois modos (selecionar/retangulo) com atalhos
  // V/R e um indicador minimo no canto. Tudo isto sera substituido pela
  // QuadroToolbar em pilula na Fase 3 (ferramentas completas, cor/traco/fill).
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [mode, setMode] = useState<CanvasMode>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftRect, setDraftRect] = useState<DraftRect | null>(null);

  // Refs espelhando o estado atual para os listeners de window/Konva e o save
  // lerem o valor mais recente sem recriar closures/listeners a cada mudanca.
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  // Transform do stage (x/y/escala). Espelhado num ref porque o Konva o altera
  // imperativamente (zoom/pan) fora do estado React; e a fonte do que serializar
  // e do que reaplicar quando o Stage remonta (ex.: recolher e reexpandir).
  const stageTransformRef = useRef<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 });
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  const hasLoadedRef = useRef(false);
  const hasClosedExplicitlyRef = useRef(false);

  // Serializa a cena atual no formato Konva (schemaVersion 1). Le o transform
  // direto do stage (fonte da verdade imperativa) com fallback para o ref.
  const serializeScene = useCallback((): string => {
    const stage = stageRef.current;
    const stageState = stage
      ? { x: stage.x(), y: stage.y(), scale: stage.scaleX() || 1 }
      : stageTransformRef.current;
    const content: CanvasSceneContent = {
      engine: "konva",
      schemaVersion: 1,
      stage: stageState,
      shapes: shapesRef.current,
    };
    return JSON.stringify(content);
  }, []);

  // Grava a cena. NAO grava antes do load concluir: fechar o painel antes da
  // leitura terminar nao pode sobrescrever o conteudo real com uma cena vazia.
  const persistScene = useCallback((): Promise<void> => {
    if (!hasLoadedRef.current || !Number.isFinite(canvasId)) {
      return Promise.resolve();
    }

    return saveCanvasContent(canvasId, serializeScene()).catch((error) => {
      console.warn("Nao foi possivel salvar o quadro.", error);
    });
  }, [canvasId, serializeScene]);

  // Autosave com o mesmo debounce de 750ms do Leitor. O flush exato fica com o
  // handleClose/flush de unmount abaixo.
  const { schedule: scheduleSave, cancel: cancelSave } = useReaderPersistence(persistScene, 750);

  // Reaplica o transform persistido no stage. Usado no load e sempre que o Stage
  // remonta (recolher/expandir desmonta e remonta o Stage, zerando o transform).
  const applyStageTransform = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const { x, y, scale } = stageTransformRef.current;
    stage.position({ x, y });
    stage.scale({ x: scale, y: scale });
    stage.batchDraw();
  }, []);

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
    const wasPanning = isPanningRef.current;
    isPanningRef.current = false;

    if (stage?.isDragging()) {
      stage.stopDrag();
    }
    stage?.draggable(false);
    stage?.batchDraw();
    setCanvasCursor(spacePressedRef.current && pointerInsideRef.current ? "grab" : "default");

    // Persiste a nova posicao do stage apos um pan efetivo.
    if (wasPanning && stage) {
      stageTransformRef.current = { x: stage.x(), y: stage.y(), scale: stage.scaleX() || 1 };
      scheduleSave();
    }
  }, [scheduleSave, setCanvasCursor]);

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

    // Persiste o novo zoom/posicao do stage.
    stageTransformRef.current = { x: stage.x(), y: stage.y(), scale: newScale };
    scheduleSave();
  }, [scheduleSave]);

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

  // Mouse down do Stage: pan tem prioridade; senao inicia o rascunho do
  // retangulo (modo "rect") ou limpa a selecao ao clicar no vazio (modo
  // "select"). Cliques sobre um retangulo sao tratados no proprio Rect (abaixo),
  // que interrompe a propagacao para este handler.
  const handleStageMouseDown = useCallback(
    (event: Konva.KonvaEventObject<MouseEvent>) => {
      handlePanStart(event);
      if (isPanningRef.current) {
        return;
      }

      if (event.evt.button !== 0) {
        return;
      }

      const stage = stageRef.current;
      if (!stage) {
        return;
      }

      if (modeRef.current === "rect") {
        const point = toCanvasPoint(stage);
        if (!point) {
          return;
        }
        drawStartRef.current = point;
        setDraftRect({ x: point.x, y: point.y, width: 0, height: 0 });
        setSelectedId(null);
        return;
      }

      // Modo selecionar: clique no vazio (target === o proprio stage) deseleciona.
      if (event.target === stage) {
        setSelectedId(null);
      }
    },
    [handlePanStart],
  );

  const handleStageMouseMove = useCallback(() => {
    if (modeRef.current !== "rect" || !drawStartRef.current) {
      return;
    }

    const stage = stageRef.current;
    if (!stage) {
      return;
    }

    const point = toCanvasPoint(stage);
    if (!point) {
      return;
    }
    setDraftRect(normalizeDraft(drawStartRef.current, point));
  }, []);

  const handleStageMouseUp = useCallback(() => {
    finishPan();

    if (!drawStartRef.current) {
      return;
    }

    const draft = draftRect;
    drawStartRef.current = null;
    setDraftRect(null);

    // Clique sem arrasto real: nao cria retangulo.
    if (!draft || draft.width < minShapeSize || draft.height < minShapeSize) {
      return;
    }

    const newShape: CanvasShape = {
      id: createShapeId(),
      type: "rect",
      x: draft.x,
      y: draft.y,
      width: draft.width,
      height: draft.height,
      rotation: 0,
      stroke: shapeDefaultStroke,
      strokeWidth: shapeDefaultStrokeWidth,
      fill: null,
    };
    setShapes((current) => [...current, newShape]);
    setSelectedId(newShape.id);
    scheduleSave();
  }, [draftRect, finishPan, scheduleSave]);

  // Move um retangulo no modo selecionar: persiste a nova posicao ao soltar.
  const handleShapeDragEnd = useCallback(
    (id: string, event: Konva.KonvaEventObject<DragEvent>) => {
      const node = event.target;
      const nextX = node.x();
      const nextY = node.y();
      setShapes((current) => current.map((shape) => (shape.id === id ? { ...shape, x: nextX, y: nextY } : shape)));
      scheduleSave();
    },
    [scheduleSave],
  );

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

  // Load ao montar: hidrata formas e o transform do stage a partir do content
  // persistido. Conteudo antigo (Excalidraw) ou corrompido abre como cena vazia,
  // sem erro para o usuario (parseCanvasContent nunca lanca).
  useEffect(() => {
    if (!Number.isFinite(canvasId)) {
      hasLoadedRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const raw = await getCanvasContent(canvasId);
        if (cancelled) {
          return;
        }
        const scene = parseCanvasContent(raw);
        stageTransformRef.current = scene.stage;
        setShapes(scene.shapes);
        applyStageTransform();
      } catch (error) {
        // Quadro nao encontrado ou falha de leitura: abre vazio, sem alarde.
        console.warn("Nao foi possivel carregar o quadro.", error);
      } finally {
        if (!cancelled) {
          hasLoadedRef.current = true;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [applyStageTransform, canvasId]);

  // Reaplica o transform persistido quando o Stage volta a ser exibido: recolher
  // o painel desmonta o Stage e reexpandir o traz zerado.
  useEffect(() => {
    if (!isCollapsed) {
      applyStageTransform();
    }
  }, [applyStageTransform, isCollapsed]);

  // Atalhos temporarios de ferramenta (Fase 2): V = selecionar, R = retangulo,
  // Delete/Backspace = remover a selecao. Gated pelo ponteiro dentro do Quadro
  // para nao sequestrar o teclado de outros paineis. Some junto com a interacao
  // temporaria quando a QuadroToolbar chegar na Fase 3.
  useEffect(() => {
    function handleToolKeys(event: KeyboardEvent) {
      if (!pointerInsideRef.current || isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "v" || event.key === "V") {
        setMode("select");
        return;
      }

      if (event.key === "r" || event.key === "R") {
        setMode("rect");
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        const currentSelected = selectedIdRef.current;
        if (!currentSelected) {
          return;
        }
        event.preventDefault();
        setShapes((current) => current.filter((shape) => shape.id !== currentSelected));
        setSelectedId(null);
        scheduleSave();
      }
    }

    window.addEventListener("keydown", handleToolKeys);
    return () => window.removeEventListener("keydown", handleToolKeys);
  }, [scheduleSave]);

  // Flush no unmount sem fechamento explicito (ex.: navegacao que desmonta o
  // painel). Roda o mesmo save do fechamento, sem onClose. useLayoutEffect para
  // o cleanup executar antes do stage ser destacado.
  const persistOnUnmountRef = useRef<() => void>(() => {});
  persistOnUnmountRef.current = () => {
    if (hasClosedExplicitlyRef.current) {
      return;
    }
    cancelSave();
    void persistScene();
  };
  useLayoutEffect(() => () => persistOnUnmountRef.current(), []);

  // Flush imediato ao fechar (mesmo padrao do Leitor): cancela o debounce e grava
  // a cena atual; depois invalida a lista para o card refletir o "Editado ha X".
  const handleClose = useCallback(() => {
    hasClosedExplicitlyRef.current = true;
    cancelSave();
    void persistScene().finally(() => {
      onCanvasChanged();
    });
    onClose();
  }, [cancelSave, onCanvasChanged, onClose, persistScene]);

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
              onClick={handleClose}
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
          className="relative min-h-0 flex-1 overflow-hidden"
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
          {/* INDICADOR/CONTROLE TEMPORARIO (Fase 2): mostra o modo atual e
              permite troca-lo por clique, alem dos atalhos V/R. Sera substituido
              pela QuadroToolbar em pilula na Fase 3. */}
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1 rounded-lg border border-[var(--floating-header-border)] bg-[var(--floating-header-bg)] p-1 shadow-md">
            <button
              type="button"
              aria-label="Modo selecionar (V)"
              title="Selecionar (V)"
              aria-pressed={mode === "select"}
              onClick={() => setMode("select")}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                mode === "select"
                  ? "bg-[var(--floating-header-hover-bg)] text-[var(--floating-header-text)]"
                  : "text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)]"
              }`}
            >
              V
            </button>
            <button
              type="button"
              aria-label="Modo retangulo (R)"
              title="Retangulo (R)"
              aria-pressed={mode === "rect"}
              onClick={() => setMode("rect")}
              className={`rounded-md px-2 py-1 text-xs font-semibold transition ${
                mode === "rect"
                  ? "bg-[var(--floating-header-hover-bg)] text-[var(--floating-header-text)]"
                  : "text-[var(--floating-header-control)] hover:bg-[var(--floating-header-hover-bg)]"
              }`}
            >
              R
            </button>
          </div>
          <Stage
            ref={stageRef}
            width={stageSize.width}
            height={stageSize.height}
            role="application"
            title="Quadro: V seleciona, R desenha retangulo; roda do mouse faz zoom e o botao do meio ou Espaco faz pan"
            onWheel={handleWheel}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onDragEnd={finishPan}
          >
            <Layer>
              <CanvasGrid />
              {shapes.map((shape) => (
                <Rect
                  key={shape.id}
                  x={shape.x}
                  y={shape.y}
                  width={shape.width}
                  height={shape.height}
                  rotation={shape.rotation}
                  stroke={shape.id === selectedId ? selectionStroke : shape.stroke}
                  strokeWidth={shape.strokeWidth}
                  fill={shape.fill ?? undefined}
                  draggable={mode === "select"}
                  perfectDrawEnabled={false}
                  onMouseDown={(event) => {
                    if (modeRef.current !== "select") {
                      return;
                    }
                    // Seleciona e impede o handler do stage (pan/deselecao) de rodar.
                    event.cancelBubble = true;
                    setSelectedId(shape.id);
                  }}
                  onDragEnd={(event) => handleShapeDragEnd(shape.id, event)}
                />
              ))}
              {draftRect ? (
                <Rect
                  x={draftRect.x}
                  y={draftRect.y}
                  width={draftRect.width}
                  height={draftRect.height}
                  stroke={shapeDefaultStroke}
                  strokeWidth={shapeDefaultStrokeWidth}
                  dash={[6, 4]}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              ) : null}
            </Layer>
          </Stage>
        </div>
      )}
    </FloatingPanelFrame>
  );
}
