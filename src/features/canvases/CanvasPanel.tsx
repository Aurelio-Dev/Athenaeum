import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { Arrow, Circle, Ellipse, Layer, Line, Rect, Shape, Stage } from "react-konva";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { getCanvasContent, saveCanvasContent } from "../../lib/database";
import { useReaderPersistence } from "../reader/useReaderPersistence";
import {
  createShapeId,
  diamondPoints,
  parseCanvasContent,
  type CanvasSceneContent,
  type CanvasShape,
  type CanvasShapeType,
} from "./canvasScene";
import { eraseAlongSegment } from "./canvasEraser";
import { CanvasToolbar, isShapeTool, type CanvasTool } from "./CanvasToolbar";
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

type Point = { x: number; y: number };
// Forma em construcao. As ferramentas de arrasto (rect/diamond/ellipse/arrow/
// line) guardam inicio/atual; o lapis (freedraw) acumula um caminho de pontos.
// Uniao discriminada por type para o TypeScript garantir o acesso correto.
type DraftShape =
  | { type: Exclude<CanvasShapeType, "freedraw">; start: Point; current: Point }
  | { type: "freedraw"; points: Point[] };
// Geometria resolvida de uma forma — o suficiente para renderiza-la.
type ShapeGeometry = { x: number; y: number; width: number; height: number; points: number[] };

const shapeDefaultStroke = "#2C1A10";
const shapeDefaultStrokeWidth = 2;
// Realce visual (apenas em runtime) da forma selecionada — nao altera o stroke
// persistido da forma.
const selectionStroke = "#B0592B";
// Abaixo disso trata-se de um clique sem arrasto: nao cria forma degenerada.
const minShapeSize = 3;
// Aumenta a area clicavel das formas de traco fino (seta/linha/freedraw).
const directionalHitStrokeWidth = 12;
// Distancia minima (em coordenadas do stage) entre pontos capturados do lapis:
// evita arrays enormes e pontos redundantes em movimento lento.
const freedrawMinDistance = 3;
// Raio de alcance da borracha, em coordenadas do stage (o circulo indicador
// escala junto com o zoom, coerente com a area real de apagamento).
const eraserRadius = 12;

// Resolve a geometria de uma forma a partir do arrasto (inicio -> atual). Retorna
// null quando o arrasto e pequeno demais (clique sem desenho real).
function geometryFromDrag(type: CanvasShapeType, start: Point, current: Point): ShapeGeometry | null {
  const dx = current.x - start.x;
  const dy = current.y - start.y;

  // Seta/linha sao direcionais: ancoram no inicio e guardam os pontos relativos
  // [0, 0, dx, dy]. Inicio -> fim importa (a ponta da seta fica no fim).
  if (type === "arrow" || type === "line") {
    if (Math.abs(dx) < minShapeSize && Math.abs(dy) < minShapeSize) {
      return null;
    }
    return { x: start.x, y: start.y, width: Math.abs(dx), height: Math.abs(dy), points: [0, 0, dx, dy] };
  }

  // Demais formas usam caixa delimitadora normalizada (arrasto em qualquer direcao).
  const width = Math.abs(dx);
  const height = Math.abs(dy);
  if (width < minShapeSize || height < minShapeSize) {
    return null;
  }
  return { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width, height, points: [] };
}

// Resolve a geometria de um traco livre. Mesma convencao das direcionais: ancora
// no primeiro ponto e guarda os demais relativos a ela. width/height ficam com a
// caixa delimitadora do traco (nao usados na renderizacao, mas coerentes com o
// schema). Retorna null com menos de 2 pontos (clique unico sem arrastar).
function geometryFromFreedraw(points: Point[]): ShapeGeometry | null {
  if (points.length < 2) {
    return null;
  }

  const anchor = points[0];
  const flat: number[] = [];
  let maxX = 0;
  let maxY = 0;
  for (const point of points) {
    const relativeX = point.x - anchor.x;
    const relativeY = point.y - anchor.y;
    flat.push(relativeX, relativeY);
    maxX = Math.max(maxX, Math.abs(relativeX));
    maxY = Math.max(maxY, Math.abs(relativeY));
  }

  return { x: anchor.x, y: anchor.y, width: maxX, height: maxY, points: flat };
}

type RenderShapeOptions = {
  key?: string;
  strokeColor: string;
  strokeWidth: number;
  fill: string | null;
  rotation: number;
  dashed?: boolean;
  draggable?: boolean;
  onMouseDown?: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragEnd?: (event: Konva.KonvaEventObject<DragEvent>) => void;
};

// Renderiza qualquer tipo de forma como o node Konva correspondente. Fonte unica
// de "tipo -> geometria na tela", usada tanto pelas formas persistidas quanto
// pelo preview tracejado durante o desenho. As coordenadas sao escolhidas para
// que node.x()/node.y() === geometry.x/geometry.y em todos os tipos, mantendo o
// mesmo handler de arrasto generico da Fase 2.
function renderCanvasShape(type: CanvasShapeType, geometry: ShapeGeometry, options: RenderShapeOptions): JSX.Element {
  const { x, y, width, height, points } = geometry;

  const common = {
    x,
    y,
    rotation: options.rotation,
    stroke: options.strokeColor,
    strokeWidth: options.strokeWidth,
    perfectDrawEnabled: false,
    ...(options.dashed
      ? { dash: [6, 4], listening: false }
      : { draggable: options.draggable, onMouseDown: options.onMouseDown, onDragEnd: options.onDragEnd }),
  };

  const fill = options.fill ?? undefined;

  switch (type) {
    case "rect":
      return <Rect key={options.key} {...common} width={width} height={height} fill={fill} />;
    case "diamond":
      return <Line key={options.key} {...common} points={diamondPoints(width, height)} closed fill={fill} />;
    case "ellipse":
      // offset negativo desloca a origem para o canto superior-esquerdo da caixa,
      // deixando node.x()/node.y() no mesmo ponto que as demais formas.
      return (
        <Ellipse
          key={options.key}
          {...common}
          radiusX={width / 2}
          radiusY={height / 2}
          offsetX={-width / 2}
          offsetY={-height / 2}
          fill={fill}
        />
      );
    case "arrow":
      // Ponta preenchida com a cor do traco (o fill persistido continua null).
      return (
        <Arrow key={options.key} {...common} points={points} fill={options.strokeColor} hitStrokeWidth={directionalHitStrokeWidth} />
      );
    case "line":
      return <Line key={options.key} {...common} points={points} hitStrokeWidth={directionalHitStrokeWidth} />;
    case "freedraw":
      // tension 0.5 suaviza o traco sem bezier completo; caps/joins arredondados
      // evitam o serrilhado nas curvas.
      return (
        <Line
          key={options.key}
          {...common}
          points={points}
          tension={0.5}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={directionalHitStrokeWidth}
        />
      );
    default: {
      // Garante exaustividade: um tipo novo sem case quebra a compilacao aqui.
      const exhaustive: never = type;
      return exhaustive;
    }
  }
}

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

  // Formas do Quadro e ferramenta ativa. A ferramenta e controlada pela
  // CanvasToolbar (pilula inferior); "select"/"pan" nao sao persistidos.
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftShape | null>(null);
  // Posicao do cursor com a Borracha ativa (circulo indicador, nao persistido).
  const [eraserCursor, setEraserCursor] = useState<Point | null>(null);

  // Refs espelhando o estado atual para os listeners de window/Konva e o save
  // lerem o valor mais recente sem recriar closures/listeners a cada mudanca.
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // Ferramenta anterior ao entrar no modo Mover, para Esc / clicar de novo voltar.
  const previousToolRef = useRef<CanvasTool>("select");
  // Transform do stage (x/y/escala). Espelhado num ref porque o Konva o altera
  // imperativamente (zoom/pan) fora do estado React; e a fonte do que serializar
  // e do que reaplicar quando o Stage remonta (ex.: recolher e reexpandir).
  const stageTransformRef = useRef<{ x: number; y: number; scale: number }>({ x: 0, y: 0, scale: 1 });
  const drawStartRef = useRef<{ x: number; y: number } | null>(null);
  // Ultima posicao da borracha durante o gesto (mousedown -> mousemove): cada
  // tick apaga ao longo do segmento anterior -> atual.
  const eraserLastPointRef = useRef<Point | null>(null);
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

  const setCanvasCursor = useCallback((cursor: "default" | "grab" | "grabbing" | "crosshair") => {
    if (canvasContainerRef.current) {
      canvasContainerRef.current.style.cursor = cursor;
    }
  }, []);

  // Cursor coerente com a ferramenta/estado atuais: grabbing durante o pan, grab
  // em modo Mover ou Espaco, crosshair ao desenhar uma forma, default no resto.
  const cursorForCurrentTool = useCallback((): "default" | "grab" | "grabbing" | "crosshair" => {
    if (isPanningRef.current) {
      return "grabbing";
    }
    if (spacePressedRef.current || toolRef.current === "pan") {
      return "grab";
    }
    if (isShapeTool(toolRef.current)) {
      return "crosshair";
    }
    return "default";
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
    setCanvasCursor(pointerInsideRef.current ? cursorForCurrentTool() : "default");

    // Persiste a nova posicao do stage apos um pan efetivo.
    if (wasPanning && stage) {
      stageTransformRef.current = { x: stage.x(), y: stage.y(), scale: stage.scaleX() || 1 };
      scheduleSave();
    }
  }, [cursorForCurrentTool, scheduleSave, setCanvasCursor]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.code !== "Space" || !pointerInsideRef.current || isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      spacePressedRef.current = true;
      setCanvasCursor(cursorForCurrentTool());
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (event.code !== "Space" || !spacePressedRef.current) {
        return;
      }

      event.preventDefault();
      spacePressedRef.current = false;
      setCanvasCursor(cursorForCurrentTool());
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
  }, [cursorForCurrentTool, finishPan, setCanvasCursor]);

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
    // Ferramenta Mover: arrastar com o botao esquerdo faz pan sem segurar Espaco.
    const canPanWithTool = event.evt.button === 0 && toolRef.current === "pan";
    if (!canPanWithMiddleButton && !canPanWithSpace && !canPanWithTool) {
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

  // Mouse down do Stage: pan tem prioridade; senao inicia o rascunho de uma forma
  // (ferramenta de forma ativa) ou limpa a selecao ao clicar no vazio (Selecionar).
  // Cliques sobre uma forma sao tratados no proprio node (abaixo), que interrompe
  // a propagacao para este handler.
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

      const activeTool = toolRef.current;
      if (activeTool === "eraser") {
        // Borracha: so guarda a posicao inicial do gesto; o apagamento acontece
        // em tempo real a cada mousemove (segmento anterior -> atual).
        const point = toCanvasPoint(stage);
        if (!point) {
          return;
        }
        eraserLastPointRef.current = point;
        setSelectedId(null);
        return;
      }

      if (isShapeTool(activeTool)) {
        const point = toCanvasPoint(stage);
        if (!point) {
          return;
        }
        drawStartRef.current = point;
        if (activeTool === "freedraw") {
          // Lapis: comeca a acumular o caminho a partir do primeiro ponto.
          setDraft({ type: "freedraw", points: [point] });
        } else {
          setDraft({ type: activeTool, start: point, current: point });
        }
        setSelectedId(null);
        return;
      }

      // Selecionar: clique no vazio (target === o proprio stage) deseleciona.
      if (event.target === stage) {
        setSelectedId(null);
      }
    },
    [handlePanStart],
  );

  const handleStageMouseMove = useCallback((event: Konva.KonvaEventObject<MouseEvent>) => {
    const activeStage = stageRef.current;
    if (!activeStage) {
      return;
    }

    if (toolRef.current === "eraser") {
      const eraserPoint = toCanvasPoint(activeStage);
      if (!eraserPoint) {
        return;
      }
      // O circulo indicador segue o cursor mesmo sem o botao pressionado.
      setEraserCursor(eraserPoint);

      // event.evt.buttons confirma que o botao esquerdo segue pressionado: um
      // mouseup fora do Stage nao chega ate nos e a borracha "grudaria" ligada.
      const lastPoint = eraserLastPointRef.current;
      if (!lastPoint || (event.evt.buttons & 1) !== 1) {
        eraserLastPointRef.current = null;
        return;
      }

      const erased = eraseAlongSegment(shapesRef.current, lastPoint, eraserPoint, eraserRadius);
      eraserLastPointRef.current = eraserPoint;
      // eraseAlongSegment devolve a MESMA referencia quando nada foi tocado.
      if (erased !== shapesRef.current) {
        // Atualiza o ref imediatamente: dois mousemove podem chegar antes do
        // proximo render, e o segundo precisa operar sobre o resultado do primeiro.
        shapesRef.current = erased;
        setShapes(erased);
        scheduleSave();
      }
      return;
    }

    if (!isShapeTool(toolRef.current) || !drawStartRef.current) {
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

    if (toolRef.current === "freedraw") {
      // Acrescenta o ponto so se o cursor andou mais que o limiar desde o ultimo
      // ponto capturado (evita arrays enormes e pontos redundantes).
      setDraft((current) => {
        if (!current || current.type !== "freedraw") {
          return current;
        }
        const last = current.points[current.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) < freedrawMinDistance) {
          return current;
        }
        return { type: "freedraw", points: [...current.points, point] };
      });
      return;
    }

    setDraft((current) => (current && current.type !== "freedraw" ? { ...current, current: point } : current));
  }, [scheduleSave]);

  const handleStageMouseUp = useCallback(() => {
    finishPan();

    // Borracha: mouseup so encerra o gesto — a remocao ja aconteceu em tempo
    // real durante o mousemove.
    eraserLastPointRef.current = null;

    if (!drawStartRef.current) {
      return;
    }

    const currentDraft = draft;
    drawStartRef.current = null;
    setDraft(null);

    if (!currentDraft) {
      return;
    }

    const geometry =
      currentDraft.type === "freedraw"
        ? geometryFromFreedraw(currentDraft.points)
        : geometryFromDrag(currentDraft.type, currentDraft.start, currentDraft.current);
    // Clique sem arrasto real (ou traco com menos de 2 pontos): nao cria forma.
    if (!geometry) {
      return;
    }

    const newShape: CanvasShape = {
      id: createShapeId(),
      type: currentDraft.type,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      points: geometry.points,
      rotation: 0,
      stroke: shapeDefaultStroke,
      strokeWidth: shapeDefaultStrokeWidth,
      fill: null,
    };
    setShapes((current) => [...current, newShape]);
    setSelectedId(newShape.id);
    scheduleSave();
  }, [draft, finishPan, scheduleSave]);

  // Alterna o modo Mover (pan). Clicar de novo (ou Esc) volta a ferramenta anterior.
  const togglePan = useCallback(() => {
    setTool((current) => {
      if (current === "pan") {
        return previousToolRef.current;
      }
      previousToolRef.current = current;
      return "pan";
    });
  }, []);

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

  // Atalhos de teclado do Quadro, complementando a CanvasToolbar: Esc sai do modo
  // Mover (volta a ferramenta anterior); V = selecionar, R = retangulo, P = lapis,
  // E = borracha, Delete/Backspace = remover a selecao. Gated pelo ponteiro
  // dentro do Quadro para nao sequestrar o teclado de outros paineis.
  useEffect(() => {
    function handleToolKeys(event: KeyboardEvent) {
      // Esc sai do Mover mesmo com o ponteiro fora (e so um toggle de modo, seguro).
      if (event.key === "Escape") {
        if (toolRef.current === "pan") {
          setTool(previousToolRef.current);
        }
        return;
      }

      if (!pointerInsideRef.current || isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "v" || event.key === "V") {
        setTool("select");
        return;
      }

      if (event.key === "r" || event.key === "R") {
        setTool("rect");
        return;
      }

      if (event.key === "p" || event.key === "P") {
        setTool("freedraw");
        return;
      }

      if (event.key === "e" || event.key === "E") {
        setTool("eraser");
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

  // Mantem o cursor coerente ao trocar de ferramenta enquanto o ponteiro esta
  // sobre o Quadro (ex.: selecionar uma forma vira crosshair; Mover vira grab).
  useEffect(() => {
    if (pointerInsideRef.current) {
      setCanvasCursor(cursorForCurrentTool());
    }
  }, [cursorForCurrentTool, setCanvasCursor, tool]);

  // Saiu da Borracha: some o circulo indicador e encerra qualquer gesto ativo.
  useEffect(() => {
    if (tool !== "eraser") {
      setEraserCursor(null);
      eraserLastPointRef.current = null;
    }
  }, [tool]);

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
            setCanvasCursor(cursorForCurrentTool());
          }}
          onPointerLeave={() => {
            pointerInsideRef.current = false;
            // O indicador da borracha nao deve ficar "congelado" fora do canvas.
            setEraserCursor(null);
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
            title="Quadro: use a barra inferior para escolher a ferramenta; roda do mouse faz zoom e o botao do meio ou Espaco faz pan"
            onWheel={handleWheel}
            onMouseDown={handleStageMouseDown}
            onMouseMove={handleStageMouseMove}
            onMouseUp={handleStageMouseUp}
            onDragEnd={finishPan}
          >
            <Layer>
              <CanvasGrid />
              {shapes.map((shape) =>
                renderCanvasShape(
                  shape.type,
                  { x: shape.x, y: shape.y, width: shape.width, height: shape.height, points: shape.points },
                  {
                    key: shape.id,
                    strokeColor: shape.id === selectedId ? selectionStroke : shape.stroke,
                    strokeWidth: shape.strokeWidth,
                    fill: shape.fill,
                    rotation: shape.rotation,
                    draggable: tool === "select",
                    onMouseDown: (event) => {
                      if (toolRef.current !== "select") {
                        return;
                      }
                      // Seleciona e impede o handler do stage (pan/deselecao) de rodar.
                      event.cancelBubble = true;
                      setSelectedId(shape.id);
                    },
                    onDragEnd: (event) => handleShapeDragEnd(shape.id, event),
                  },
                ),
              )}
              {draft
                ? (() => {
                    // Preview tracejado durante o desenho: mesma geometria/tipo da
                    // forma final, so que sem interacao e com traco pontilhado.
                    const geometry =
                      draft.type === "freedraw"
                        ? geometryFromFreedraw(draft.points)
                        : geometryFromDrag(draft.type, draft.start, draft.current);
                    return geometry
                      ? renderCanvasShape(draft.type, geometry, {
                          strokeColor: shapeDefaultStroke,
                          strokeWidth: shapeDefaultStrokeWidth,
                          fill: null,
                          rotation: 0,
                          dashed: true,
                        })
                      : null;
                  })()
                : null}
              {tool === "eraser" && eraserCursor ? (
                // Indicador do alcance da borracha (runtime, nao persistido).
                <Circle
                  x={eraserCursor.x}
                  y={eraserCursor.y}
                  radius={eraserRadius}
                  stroke={shapeDefaultStroke}
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              ) : null}
            </Layer>
          </Stage>
          <CanvasToolbar tool={tool} onSelectTool={setTool} onTogglePan={togglePan} />
        </div>
      )}
    </FloatingPanelFrame>
  );
}
