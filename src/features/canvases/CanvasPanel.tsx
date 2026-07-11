import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import {
  Arrow,
  Circle,
  Ellipse,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Shape,
  Stage,
  Text,
  Transformer,
} from "react-konva";
import { FloatingPanelFrame } from "../../components/floating/FloatingPanelFrame";
import { useFloatingPanels, type FloatingPanel } from "../../components/floating/FloatingPanelsContext";
import { getCanvasContent, loadCanvasFiles, saveCanvasContent, saveCanvasFile } from "../../lib/database";
import { useReaderPersistence } from "../reader/useReaderPersistence";
import {
  createShapeId,
  diamondPoints,
  parseCanvasContent,
  type CanvasFillStyle,
  type CanvasSceneContent,
  type CanvasShape,
  type CanvasShapeType,
} from "./canvasScene";
import { eraseAlongSegment } from "./canvasEraser";
import { CanvasToolbar, isShapeTool, type CanvasTool } from "./CanvasToolbar";
import { CanvasPropertiesPanel } from "./CanvasPropertiesPanel";
import { canvasPanelHeight, canvasPanelMinHeight, canvasPanelMinWidth, canvasPanelWidth } from "./canvasPanelDimensions";
import { getCanvasPropertiesSections } from "./canvasPropertiesSections";
import {
  getDirectionalEndpoints,
  moveDirectionalEndpoint,
  type DirectionalEndpoint,
} from "./canvasDirectionalHandles";
import {
  finalizeCanvasTransform,
  finalizeFreedrawTransform,
  getCanvasPointsSize,
  lockSideAnchorAspectRatio,
  scaleTextFontSize,
  type CanvasTransformBox,
} from "./canvasTransform";
import { getFillPatternImage } from "./canvasFillPattern";

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
  | { type: Exclude<CanvasShapeType, "freedraw" | "text" | "image">; start: Point; current: Point }
  | { type: "freedraw"; points: Point[] };
type EditingText = { id: string; value: string };
type CanvasDefaultStyle = { stroke: string; strokeWidth: number; fill: string | null; fillStyle: CanvasFillStyle };
// Geometria resolvida de uma forma — o suficiente para renderiza-la.
type ShapeGeometry = { x: number; y: number; width: number; height: number; points: number[] };

const initialDefaultStyle: CanvasDefaultStyle = { stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "none" };
// Quando a selecao continua ativa fora da ferramenta Selecionar, os handles nao
// aparecem; este realce preserva a indicacao visual sem esconder a cor durante
// a edicao normal pelo painel de propriedades.
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
const textDefaultFontSize = 16;
const textLineHeight = 1.2;
const frameStroke = "#7A6558";
const maximumImageSide = 400;
const maximumImageBytes = 4 * 1024 * 1024;
const allowedImageMimeTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const transformerShapeTypes: readonly CanvasShapeType[] = ["rect", "diamond", "ellipse", "image", "frame", "freedraw", "text"];

function supportsTransformer(type: CanvasShapeType): boolean {
  return transformerShapeTypes.includes(type);
}

function getCanvasUiFontFamily(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--font-sans").trim();
}

function getCanvasCssColor(variableName: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim() || fallback;
}

function measureTextBox(text: string, fontSize: number, fontFamily: string): { width: number; height: number } {
  const context = document.createElement("canvas").getContext("2d");
  const lines = text.split("\n");
  let width = 0;

  if (context) {
    context.font = `${fontSize}px ${fontFamily}`;
    for (const line of lines) {
      width = Math.max(width, context.measureText(line).width);
    }
  }

  return {
    width: Math.ceil(width),
    height: Math.ceil(lines.length * fontSize * textLineHeight),
  };
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler a imagem selecionada."));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("Não foi possível ler a imagem selecionada."));
        return;
      }
      const separatorIndex = reader.result.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("O conteúdo da imagem selecionada é inválido."));
        return;
      }
      resolve(reader.result.slice(separatorIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(mimeType: string, dataBase64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => {
      if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
        reject(new Error("A imagem selecionada não possui dimensões válidas."));
        return;
      }
      resolve(image);
    };
    image.onerror = () => reject(new Error("Não foi possível decodificar a imagem selecionada."));
    image.src = `data:${mimeType};base64,${dataBase64}`;
  });
}

function imageErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return typeof error === "string" && error.length > 0 ? error : "Não foi possível inserir a imagem.";
}

// Resolve a geometria de uma forma a partir do arrasto (inicio -> atual). Retorna
// null quando o arrasto e pequeno demais (clique sem desenho real).
function geometryFromDrag(
  type: Exclude<CanvasShapeType, "freedraw" | "text" | "image">,
  start: Point,
  current: Point,
): ShapeGeometry | null {
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
  fillColor: string;
  fillStyle: CanvasFillStyle;
  rotation: number;
  dashed?: boolean;
  draggable?: boolean;
  onMouseDown?: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onDblClick?: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onDragEnd?: (event: Konva.KonvaEventObject<DragEvent>) => void;
  onTransform?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformStart?: (event: Konva.KonvaEventObject<Event>) => void;
  onTransformEnd?: (event: Konva.KonvaEventObject<Event>) => void;
  nodeRef?: (node: Konva.Node | null) => void;
  frameLabelRef?: (node: Konva.Text | null) => void;
  text: string;
  textColor: string;
  fontSize: number;
  fontFamily: string;
  image: HTMLImageElement | null;
};

type ShapeFillProps = {
  fill?: string;
  fillPatternImage?: HTMLImageElement;
  fillPatternRepeat?: "repeat";
  fillPriority?: "pattern";
};

function getShapeFillProps(fillStyle: CanvasFillStyle, color: string): ShapeFillProps {
  if (fillStyle === "solid") {
    return { fill: color };
  }
  if (fillStyle === "hachure" || fillStyle === "cross-hatch") {
    return {
      // O Konva aceita CanvasImageSource em runtime, mas a tipagem exposta por
      // react-konva restringe esta prop a HTMLImageElement.
      fillPatternImage: getFillPatternImage(fillStyle, color) as unknown as HTMLImageElement,
      fillPatternRepeat: "repeat",
      fillPriority: "pattern",
    };
  }
  return {};
}

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
    strokeScaleEnabled: false,
    perfectDrawEnabled: false,
    ref: options.nodeRef,
    ...(options.dashed
      ? { dash: [6, 4], listening: false }
      : {
          draggable: options.draggable,
          onMouseDown: options.onMouseDown,
          onDblClick: options.onDblClick,
          onDragMove: options.onDragMove,
          onDragEnd: options.onDragEnd,
          onTransform: options.onTransform,
          onTransformStart: options.onTransformStart,
          onTransformEnd: options.onTransformEnd,
        }),
  };

  const fillProps =
    type === "rect" || type === "diamond" || type === "ellipse"
      ? getShapeFillProps(options.fillStyle, options.fillColor)
      : {};

  switch (type) {
    case "rect":
      return <Rect key={options.key} {...common} {...fillProps} width={width} height={height} />;
    case "diamond":
      return (
        <Group
          key={options.key}
          x={x}
          y={y}
          width={width}
          height={height}
          rotation={options.rotation}
          listening={!options.dashed}
          draggable={options.draggable}
          ref={options.nodeRef}
          onMouseDown={options.onMouseDown}
          onDblClick={options.onDblClick}
          onDragEnd={options.onDragEnd}
          onTransformStart={options.onTransformStart}
          onTransformEnd={options.onTransformEnd}
        >
          <Line
            points={diamondPoints(width, height)}
            closed
            {...fillProps}
            stroke={options.strokeColor}
            strokeWidth={options.strokeWidth}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            dash={options.dashed ? [6, 4] : undefined}
          />
        </Group>
      );
    case "ellipse":
      return (
        <Group
          key={options.key}
          x={x}
          y={y}
          width={width}
          height={height}
          rotation={options.rotation}
          listening={!options.dashed}
          draggable={options.draggable}
          ref={options.nodeRef}
          onMouseDown={options.onMouseDown}
          onDblClick={options.onDblClick}
          onDragEnd={options.onDragEnd}
          onTransformStart={options.onTransformStart}
          onTransformEnd={options.onTransformEnd}
        >
          <Ellipse
            x={width / 2}
            y={height / 2}
            radiusX={width / 2}
            radiusY={height / 2}
            {...fillProps}
            stroke={options.strokeColor}
            strokeWidth={options.strokeWidth}
            strokeScaleEnabled={false}
            perfectDrawEnabled={false}
            dash={options.dashed ? [6, 4] : undefined}
          />
        </Group>
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
    case "text":
      return (
        <Text
          key={options.key}
          x={x}
          y={y}
          rotation={options.rotation}
          text={options.text}
          width={width}
          height={height}
          fontSize={options.fontSize}
          fontFamily={options.fontFamily}
          lineHeight={textLineHeight}
          wrap="none"
          fill={options.textColor}
          perfectDrawEnabled={false}
          ref={options.nodeRef}
          draggable={options.draggable}
          onMouseDown={options.onMouseDown}
          onDblClick={options.onDblClick}
          onDragEnd={options.onDragEnd}
          onTransform={options.onTransform}
          onTransformStart={options.onTransformStart}
          onTransformEnd={options.onTransformEnd}
        />
      );
    case "image":
      if (options.image) {
        return <KonvaImage key={options.key} {...common} image={options.image} width={width} height={height} />;
      }
      return (
        <Group
          key={options.key}
          x={x}
          y={y}
          width={width}
          height={height}
          rotation={options.rotation}
          draggable={options.draggable}
          ref={options.nodeRef}
          onMouseDown={options.onMouseDown}
          onDragEnd={options.onDragEnd}
          onTransformStart={options.onTransformStart}
          onTransformEnd={options.onTransformEnd}
        >
          <Rect
            width={width}
            height={height}
            fill="#D8D2CC"
            stroke={options.strokeColor === "transparent" ? frameStroke : options.strokeColor}
            strokeWidth={options.strokeWidth}
            strokeScaleEnabled={false}
          />
          <Rect
            x={Math.max(6, width * 0.25)}
            y={Math.max(6, height * 0.25)}
            width={Math.max(16, width * 0.5)}
            height={Math.max(14, height * 0.5)}
            stroke="#7A6558"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
          <Line
            points={[
              Math.max(8, width * 0.28),
              Math.max(12, height * 0.68),
              width * 0.43,
              height * 0.48,
              width * 0.53,
              height * 0.58,
              width * 0.7,
              height * 0.38,
            ]}
            stroke="#7A6558"
            strokeWidth={1.5}
            strokeScaleEnabled={false}
          />
        </Group>
      );
    case "frame": {
      const angle = (options.rotation * Math.PI) / 180;
      return (
        <Fragment key={options.key}>
          <Group
            x={x}
            y={y}
            width={width}
            height={height}
            rotation={options.rotation}
            listening={!options.dashed}
            draggable={options.draggable}
            ref={options.nodeRef}
            onMouseDown={options.onMouseDown}
            onDragMove={options.onDragMove}
            onDragEnd={options.onDragEnd}
            onTransform={options.onTransform}
            onTransformStart={options.onTransformStart}
            onTransformEnd={options.onTransformEnd}
          >
            <Rect
              width={width}
              height={height}
              stroke={options.strokeColor}
              strokeWidth={options.strokeWidth}
              dash={[6, 4]}
              strokeScaleEnabled={false}
              perfectDrawEnabled={false}
            />
          </Group>
          <Text
            ref={options.frameLabelRef}
            x={x + Math.sin(angle) * 16}
            y={y - Math.cos(angle) * 16}
            rotation={options.rotation}
            text="Frame"
            fontSize={12}
            fontFamily={options.fontFamily}
            fill={options.strokeColor}
            listening={false}
          />
        </Fragment>
      );
    }
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
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const shapeNodesRef = useRef<Map<string, Konva.Node>>(new Map());
  const frameLabelNodesRef = useRef<Map<string, Konva.Text>>(new Map());
  const transformAspectRatioRef = useRef(1);
  const transformingShapeTypeRef = useRef<CanvasShapeType | null>(null);
  const shiftPressedRef = useRef(false);
  const pointerInsideRef = useRef(false);
  const spacePressedRef = useRef(false);
  const isPanningRef = useRef(false);

  // Formas do Quadro e ferramenta ativa. A ferramenta e controlada pela
  // CanvasToolbar (pilula inferior); "select"/"pan" nao sao persistidos.
  const [shapes, setShapes] = useState<CanvasShape[]>([]);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [defaultStyle, setDefaultStyle] = useState<CanvasDefaultStyle>(() => ({ ...initialDefaultStyle }));
  const [draft, setDraft] = useState<DraftShape | null>(null);
  const [editingText, setEditingText] = useState<EditingText | null>(null);
  const [canvasUiFontFamily] = useState(getCanvasUiFontFamily);
  const [directionalHandleColors] = useState(() => ({
    fill: getCanvasCssColor("--card", "#FAF5EF"),
    stroke: getCanvasCssColor("--accent", "#9C5A2E"),
  }));
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const pendingImagePointRef = useRef<Point | null>(null);
  const imageImportInProgressRef = useRef(false);
  const isMountedRef = useRef(true);
  const [imageCache, setImageCache] = useState<Map<string, HTMLImageElement>>(() => new Map());
  const [imageError, setImageError] = useState("");
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
  const defaultStyleRef = useRef(defaultStyle);
  defaultStyleRef.current = defaultStyle;
  const editingTextRef = useRef(editingText);
  editingTextRef.current = editingText;
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

  const registerShapeNode = useCallback((shapeId: string, node: Konva.Node | null) => {
    if (node) {
      shapeNodesRef.current.set(shapeId, node);
    } else {
      shapeNodesRef.current.delete(shapeId);
    }
  }, []);

  const registerFrameLabelNode = useCallback((shapeId: string, node: Konva.Text | null) => {
    if (node) {
      frameLabelNodesRef.current.set(shapeId, node);
    } else {
      frameLabelNodesRef.current.delete(shapeId);
    }
  }, []);

  const syncFrameLabelNode = useCallback((shapeId: string, node: Konva.Node) => {
    const label = frameLabelNodesRef.current.get(shapeId);
    if (!label) {
      return;
    }
    const angle = (node.rotation() * Math.PI) / 180;
    label.position({
      x: node.x() + Math.sin(angle) * 16,
      y: node.y() - Math.cos(angle) * 16,
    });
    label.rotation(node.rotation());
    label.getLayer()?.batchDraw();
  }, []);

  const handleShapeTransformStart = useCallback((shapeId: string) => {
    const shape = shapesRef.current.find((candidate) => candidate.id === shapeId);
    if (!shape) {
      transformingShapeTypeRef.current = null;
      transformAspectRatioRef.current = 1;
      return;
    }
    transformingShapeTypeRef.current = shape.type;
    const size = shape.type === "freedraw" ? getCanvasPointsSize(shape.points) : shape;
    const width = Math.abs(size.width);
    const height = Math.abs(size.height);
    transformAspectRatioRef.current = width > 0 && height > 0 ? width / height : 1;
  }, []);

  const handleShapeTransformEnd = useCallback(
    (shapeId: string, event: Konva.KonvaEventObject<Event>) => {
      const node = event.target;
      const shape = shapesRef.current.find((candidate) => candidate.id === shapeId);
      transformingShapeTypeRef.current = null;
      if (!shape || !supportsTransformer(shape.type)) {
        return;
      }

      const finalTransform =
        shape.type === "text"
          ? (() => {
              // keepRatio mantem ambos os eixos iguais; a media protege contra
              // pequenas diferencas numericas internas do Konva.
              const scale = (Math.abs(node.scaleX()) + Math.abs(node.scaleY())) / 2;
              const fontSize = scaleTextFontSize(shape.fontSize, scale);
              const box = measureTextBox(shape.text, fontSize, canvasUiFontFamily);
              return {
                x: node.x(),
                y: node.y(),
                width: box.width,
                height: box.height,
                rotation: node.rotation(),
                fontSize,
              };
            })()
          : shape.type === "freedraw"
          ? finalizeFreedrawTransform({
              x: node.x(),
              y: node.y(),
              points: shape.points,
              scaleX: node.scaleX(),
              scaleY: node.scaleY(),
              rotation: node.rotation(),
            })
          : finalizeCanvasTransform({
              x: node.x(),
              y: node.y(),
              width: shape.width,
              height: shape.height,
              scaleX: node.scaleX(),
              scaleY: node.scaleY(),
              rotation: node.rotation(),
            });

      // O Transformer altera scale temporariamente. Consolidar em dimensoes
      // reais evita persistir escala e impede que o stroke continue deformado.
      node.scale({ x: 1, y: 1 });
      node.position({ x: finalTransform.x, y: finalTransform.y });
      node.rotation(finalTransform.rotation);
      if (shape.type === "frame") {
        syncFrameLabelNode(shapeId, node);
      }

      const nextShapes = shapesRef.current.map((candidate) =>
        candidate.id === shapeId ? { ...candidate, ...finalTransform } : candidate,
      );
      shapesRef.current = nextShapes;
      setShapes(nextShapes);
      transformerRef.current?.forceUpdate();
      node.getLayer()?.batchDraw();
      scheduleSave();
    },
    [canvasUiFontFamily, scheduleSave, syncFrameLabelNode],
  );

  const handleTransformerBoundBox = useCallback(
    (oldBox: CanvasTransformBox, newBox: CanvasTransformBox): CanvasTransformBox => {
      // Texto nao admite espelhamento: manter a caixa anterior caso um canto
      // atravesse o lado oposto durante o arrasto.
      if (transformingShapeTypeRef.current === "text") {
        return newBox.width <= 0 || newBox.height <= 0 ? oldBox : newBox;
      }
      if (!shiftPressedRef.current) {
        return newBox;
      }
      return lockSideAnchorAspectRatio(
        newBox,
        transformerRef.current?.getActiveAnchor() ?? null,
        transformAspectRatioRef.current,
      );
    },
    [],
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleImageFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = "";
      const insertionPoint = pendingImagePointRef.current;
      pendingImagePointRef.current = null;

      if (!file || !insertionPoint || imageImportInProgressRef.current) {
        return;
      }

      imageImportInProgressRef.current = true;
      setImageError("");
      try {
        if (!allowedImageMimeTypes.has(file.type)) {
          throw new Error("Selecione uma imagem PNG, JPEG, GIF ou WebP.");
        }
        if (file.size > maximumImageBytes) {
          throw new Error("A imagem deve ter no máximo 4MB.");
        }

        const dataBase64 = await readFileAsBase64(file);
        const image = await loadHtmlImage(file.type, dataBase64);
        if (!isMountedRef.current) {
          return;
        }

        const scale = Math.min(1, maximumImageSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const fileId = crypto.randomUUID();

        // O Rust grava e registra o arquivo antes de a cena passar a referencia-lo.
        // Se o save falhar, nenhuma forma quebrada entra no Quadro.
        await saveCanvasFile(canvasId, { fileId, mimeType: file.type, dataBase64 });
        if (!isMountedRef.current) {
          return;
        }

        setImageCache((current) => {
          const next = new Map(current);
          next.set(fileId, image);
          return next;
        });

        const newShape: CanvasShape = {
          id: createShapeId(),
          type: "image",
          x: insertionPoint.x,
          y: insertionPoint.y,
          width,
          height,
          points: [],
          rotation: 0,
          stroke: initialDefaultStyle.stroke,
          strokeWidth: initialDefaultStyle.strokeWidth,
          fill: null,
          fillStyle: "none",
          text: "",
          fontSize: textDefaultFontSize,
          fileId,
        };
        const nextShapes = [...shapesRef.current, newShape];
        shapesRef.current = nextShapes;
        setShapes(nextShapes);
        setSelectedId(newShape.id);
        scheduleSave();
      } catch (error) {
        if (isMountedRef.current) {
          setImageError(imageErrorMessage(error));
        }
      } finally {
        imageImportInProgressRef.current = false;
      }
    },
    [canvasId, scheduleSave],
  );

  const finishTextEditing = useCallback(() => {
    const editing = editingTextRef.current;
    if (!editing) {
      return;
    }

    editingTextRef.current = null;
    setEditingText(null);

    const currentShape = shapesRef.current.find((shape) => shape.id === editing.id && shape.type === "text");
    if (!currentShape) {
      return;
    }

    let nextShapes: CanvasShape[];
    if (editing.value.trim().length === 0) {
      nextShapes = shapesRef.current.filter((shape) => shape.id !== editing.id);
      setSelectedId(null);
    } else {
      const box = measureTextBox(editing.value, currentShape.fontSize, canvasUiFontFamily);
      nextShapes = shapesRef.current.map((shape) =>
        shape.id === editing.id ? { ...shape, text: editing.value, width: box.width, height: box.height } : shape,
      );
      setSelectedId(editing.id);
    }

    // Atualiza o ref antes do render: um fechamento imediato precisa serializar
    // o texto final, nao a versao anterior capturada pelo ultimo render.
    shapesRef.current = nextShapes;
    setShapes(nextShapes);
    scheduleSave();
  }, [canvasUiFontFamily, scheduleSave]);

  const beginTextEditing = useCallback((shape: CanvasShape) => {
    if (shape.type !== "text") {
      return;
    }
    const nextEditing = { id: shape.id, value: shape.text };
    editingTextRef.current = nextEditing;
    setEditingText(nextEditing);
    setSelectedId(shape.id);
  }, []);

  useLayoutEffect(() => {
    const textarea = textAreaRef.current;
    if (!textarea || !editingText) {
      return;
    }

    const shape = shapesRef.current.find((candidate) => candidate.id === editingText.id && candidate.type === "text");
    const stage = stageRef.current;
    if (!shape || !stage) {
      return;
    }

    const scale = stage.scaleX() || 1;
    const box = measureTextBox(editingText.value, shape.fontSize, canvasUiFontFamily);
    textarea.style.width = `${Math.max(shape.fontSize * scale, box.width * scale + 2)}px`;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;

    // A edicao nasce dentro do mousedown do Stage. Adiar o foco evita que a
    // acao padrao desse mesmo gesto devolva o foco ao canvas e dispare blur na
    // textarea vazia logo depois de ela ser montada.
    let focusFrame: number | null = null;
    if (document.activeElement !== textarea) {
      focusFrame = window.requestAnimationFrame(() => textarea.focus());
    }
    return () => {
      if (focusFrame !== null) {
        window.cancelAnimationFrame(focusFrame);
      }
    };
  }, [canvasUiFontFamily, editingText]);

  useEffect(() => {
    function handleShiftKeyDown(event: KeyboardEvent) {
      if (event.key === "Shift") {
        shiftPressedRef.current = true;
      }
    }

    function handleShiftKeyUp(event: KeyboardEvent) {
      if (event.key === "Shift") {
        shiftPressedRef.current = false;
      }
    }

    function resetShift() {
      shiftPressedRef.current = false;
    }

    window.addEventListener("keydown", handleShiftKeyDown);
    window.addEventListener("keyup", handleShiftKeyUp);
    window.addEventListener("blur", resetShift);
    return () => {
      window.removeEventListener("keydown", handleShiftKeyDown);
      window.removeEventListener("keyup", handleShiftKeyUp);
      window.removeEventListener("blur", resetShift);
    };
  }, []);

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) {
      return;
    }

    const selectedShape = shapes.find((shape) => shape.id === selectedId);
    const selectedNode = selectedShape ? shapeNodesRef.current.get(selectedShape.id) : null;
    if (tool === "select" && selectedShape && supportsTransformer(selectedShape.type) && selectedNode) {
      transformer.nodes([selectedNode]);
    } else {
      transformer.nodes([]);
    }
    transformer.getLayer()?.batchDraw();
  }, [imageCache, selectedId, shapes, tool]);

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
      if (editingTextRef.current || event.code !== "Space" || !pointerInsideRef.current || isEditableTarget(event.target)) {
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
    if (editingTextRef.current) {
      return;
    }
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
    // Ctrl + scroll deve seguir o mesmo sentido da roda comum. Alguns
    // trackpads tambem sinalizam a pinça com ctrlKey, mas o delta ja traz o
    // sentido correto para o zoom do canvas.
    const direction = event.evt.deltaY > 0 ? -1 : 1;

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
    if (editingTextRef.current) {
      return;
    }
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
      if (editingTextRef.current) {
        return;
      }
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
        if (activeTool === "image") {
          pendingImagePointRef.current = point;
          setImageError("");
          imageInputRef.current?.click();
          return;
        }
        if (activeTool === "text") {
          // Impede a acao padrao do mousedown de competir com o foco do editor
          // HTML que sera montado por este mesmo gesto.
          event.evt.preventDefault();
          const style = defaultStyleRef.current;
          const newShape: CanvasShape = {
            id: createShapeId(),
            type: "text",
            x: point.x,
            y: point.y,
            width: 0,
            height: 0,
            points: [],
            rotation: 0,
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
            fill: null,
            fillStyle: "none",
            text: "",
            fontSize: textDefaultFontSize,
            fileId: null,
          };
          const nextShapes = [...shapesRef.current, newShape];
          shapesRef.current = nextShapes;
          setShapes(nextShapes);
          beginTextEditing(newShape);
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
    [beginTextEditing, handlePanStart],
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

    const style = defaultStyleRef.current;
    const newShape: CanvasShape = {
      id: createShapeId(),
      type: currentDraft.type,
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      points: geometry.points,
      rotation: 0,
      stroke: currentDraft.type === "frame" ? frameStroke : style.stroke,
      strokeWidth: currentDraft.type === "frame" ? initialDefaultStyle.strokeWidth : style.strokeWidth,
      fill: currentDraft.type === "frame" ? null : style.fill,
      fillStyle: getCanvasPropertiesSections(currentDraft.type)?.preenchimento ? style.fillStyle : "none",
      text: "",
      fontSize: textDefaultFontSize,
      fileId: null,
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

  const updateDirectionalHandle = useCallback(
    (shapeId: string, endpoint: DirectionalEndpoint, candidate: Point, persist: boolean): Point | null => {
      const shape = shapesRef.current.find(
        (current) => current.id === shapeId && (current.type === "arrow" || current.type === "line"),
      );
      if (!shape) {
        return null;
      }

      const nextGeometry = moveDirectionalEndpoint(shape, endpoint, candidate);
      const nextShapes = shapesRef.current.map((current) =>
        current.id === shapeId ? { ...current, ...nextGeometry } : current,
      );
      shapesRef.current = nextShapes;
      setShapes(nextShapes);
      if (persist) {
        scheduleSave();
      }

      return getDirectionalEndpoints(nextGeometry)[endpoint];
    },
    [scheduleSave],
  );

  const handleDirectionalHandleDrag = useCallback(
    (
      shapeId: string,
      endpoint: DirectionalEndpoint,
      event: Konva.KonvaEventObject<DragEvent>,
      persist: boolean,
    ) => {
      event.cancelBubble = true;
      const nextPoint = updateDirectionalHandle(shapeId, endpoint, { x: event.target.x(), y: event.target.y() }, persist);
      if (nextPoint) {
        // Aplica a correcao de distancia minima imediatamente, antes do proximo
        // render React, para o handle nunca parecer sobreposto ao outro.
        event.target.position(nextPoint);
      }
    },
    [updateDirectionalHandle],
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

  // Load ao montar: hidrata a cena e reconstrói as imagens mantidas em disco.
  // Falha em um arquivo individual degrada para o placeholder sem impedir que
  // o restante do Quadro seja aberto.
  useEffect(() => {
    if (!Number.isFinite(canvasId)) {
      hasLoadedRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const [raw, files] = await Promise.all([
          getCanvasContent(canvasId),
          loadCanvasFiles(canvasId).catch((error) => {
            console.warn("Não foi possível carregar os arquivos do quadro.", error);
            return [];
          }),
        ]);
        if (cancelled) {
          return;
        }
        const scene = parseCanvasContent(raw);
        stageTransformRef.current = scene.stage;
        setShapes(scene.shapes);
        applyStageTransform();

        const loadedImages = new Map<string, HTMLImageElement>();
        for (const file of files) {
          try {
            const image = await loadHtmlImage(file.mimeType, file.dataBase64);
            if (cancelled) {
              return;
            }
            loadedImages.set(file.fileId, image);
          } catch (error) {
            // Arquivo corrompido: a forma permanece e renderiza o placeholder.
            console.warn(`Não foi possível decodificar a imagem ${file.fileId} do quadro.`, error);
          }
        }
        if (!cancelled) {
          setImageCache(loadedImages);
        }
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
  // E = borracha, T = texto, I = imagem, F = frame, Delete/Backspace = remover a selecao. Gated pelo ponteiro
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

      if (event.key === "t" || event.key === "T") {
        setTool("text");
        return;
      }

      if (event.key === "i" || event.key === "I") {
        setTool("image");
        return;
      }

      if (event.key === "f" || event.key === "F") {
        setTool("frame");
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
    finishTextEditing();
    cancelSave();
    void persistScene();
  };
  useLayoutEffect(() => () => persistOnUnmountRef.current(), []);

  // Flush imediato ao fechar (mesmo padrao do Leitor): cancela o debounce e grava
  // a cena atual; depois invalida a lista para o card refletir o "Editado ha X".
  const handleClose = useCallback(() => {
    finishTextEditing();
    hasClosedExplicitlyRef.current = true;
    cancelSave();
    void persistScene().finally(() => {
      onCanvasChanged();
    });
    onClose();
  }, [cancelSave, finishTextEditing, onCanvasChanged, onClose, persistScene]);

  const handlePropertiesColorChange = useCallback(
    (stroke: string) => {
      const currentSelectedId = selectedIdRef.current;
      const selectedShape = currentSelectedId
        ? shapesRef.current.find((shape) => shape.id === currentSelectedId) ?? null
        : null;

      if (selectedShape) {
        // Texto tambem persiste a cor em stroke; o renderer a aplica como fill
        // do Konva.Text, preservando a convencao da cena existente.
        const nextShapes = shapesRef.current.map((shape) =>
          shape.id === selectedShape.id ? { ...shape, stroke } : shape,
        );
        shapesRef.current = nextShapes;
        setShapes(nextShapes);
        scheduleSave();
        return;
      }

      setDefaultStyle((current) => ({ ...current, stroke }));
    },
    [scheduleSave],
  );

  const handlePropertiesStrokeWidthChange = useCallback(
    (strokeWidth: number) => {
      const currentSelectedId = selectedIdRef.current;
      const selectedShape = currentSelectedId
        ? shapesRef.current.find((shape) => shape.id === currentSelectedId) ?? null
        : null;

      if (selectedShape) {
        const nextShapes = shapesRef.current.map((shape) =>
          shape.id === selectedShape.id ? { ...shape, strokeWidth } : shape,
        );
        shapesRef.current = nextShapes;
        setShapes(nextShapes);
        scheduleSave();
        return;
      }

      setDefaultStyle((current) => ({ ...current, strokeWidth }));
    },
    [scheduleSave],
  );

  const handlePropertiesFillStyleChange = useCallback(
    (fillStyle: CanvasFillStyle) => {
      const currentSelectedId = selectedIdRef.current;
      const selectedShape = currentSelectedId
        ? shapesRef.current.find((shape) => shape.id === currentSelectedId) ?? null
        : null;

      if (selectedShape) {
        const nextShapes = shapesRef.current.map((shape) =>
          shape.id === selectedShape.id ? { ...shape, fillStyle } : shape,
        );
        shapesRef.current = nextShapes;
        setShapes(nextShapes);
        scheduleSave();
        return;
      }

      setDefaultStyle((current) => ({ ...current, fillStyle }));
    },
    [scheduleSave],
  );

  const selectedPropertiesShape = shapes.find((shape) => shape.id === selectedId) ?? null;
  const propertiesSections = getCanvasPropertiesSections(selectedPropertiesShape?.type ?? tool);
  const propertiesStyle = selectedPropertiesShape ?? defaultStyle;
  const selectedDirectionalShape =
    tool === "select"
      ? shapes.find((shape) => shape.id === selectedId && (shape.type === "arrow" || shape.type === "line")) ?? null
      : null;
  const selectedTransformerShape =
    tool === "select" ? shapes.find((shape) => shape.id === selectedId && supportsTransformer(shape.type)) ?? null : null;
  const isTextTransformer = selectedTransformerShape?.type === "text";

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
          <input
            ref={imageInputRef}
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            className="hidden"
            onChange={(event) => void handleImageFileChange(event)}
          />
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
                editingText?.id === shape.id
                  ? null
                  : renderCanvasShape(
                  shape.type,
                  { x: shape.x, y: shape.y, width: shape.width, height: shape.height, points: shape.points },
                  {
                    key: shape.id,
                    strokeColor:
                      shape.type === "image"
                        ? "transparent"
                        : shape.id === selectedId && tool !== "select"
                          ? selectionStroke
                          : shape.stroke,
                    strokeWidth: shape.strokeWidth,
                    fillColor: shape.stroke,
                    fillStyle: shape.fillStyle,
                    rotation: shape.rotation,
                    text: shape.text,
                    textColor: shape.stroke,
                    fontSize: shape.fontSize,
                    fontFamily: canvasUiFontFamily,
                    image: shape.fileId ? imageCache.get(shape.fileId) ?? null : null,
                    draggable: tool === "select",
                    nodeRef: supportsTransformer(shape.type)
                      ? (node) => registerShapeNode(shape.id, node)
                      : undefined,
                    frameLabelRef:
                      shape.type === "frame" ? (node) => registerFrameLabelNode(shape.id, node) : undefined,
                    onMouseDown: (event) => {
                      if (toolRef.current !== "select") {
                        return;
                      }
                      // Seleciona e impede o handler do stage (pan/deselecao) de rodar.
                      event.cancelBubble = true;
                      setSelectedId(shape.id);
                    },
                    onDblClick: (event) => {
                      if (toolRef.current !== "select" || shape.type !== "text") {
                        return;
                      }
                      event.cancelBubble = true;
                      beginTextEditing(shape);
                    },
                    onDragMove:
                      shape.type === "frame" ? (event) => syncFrameLabelNode(shape.id, event.target) : undefined,
                    onDragEnd: (event) => handleShapeDragEnd(shape.id, event),
                    onTransform:
                      shape.type === "frame" ? (event) => syncFrameLabelNode(shape.id, event.target) : undefined,
                    onTransformStart: () => handleShapeTransformStart(shape.id),
                    onTransformEnd: (event) => handleShapeTransformEnd(shape.id, event),
                  },
                ),
              )}
              {selectedDirectionalShape
                ? (() => {
                    const endpoints = getDirectionalEndpoints(selectedDirectionalShape);
                    const renderHandle = (endpoint: DirectionalEndpoint, point: Point) => (
                      <Circle
                        key={`${selectedDirectionalShape.id}-${endpoint}-handle`}
                        x={point.x}
                        y={point.y}
                        radius={6}
                        fill={directionalHandleColors.fill}
                        stroke={directionalHandleColors.stroke}
                        strokeWidth={2}
                        strokeScaleEnabled={false}
                        draggable
                        onMouseDown={(event) => {
                          event.cancelBubble = true;
                        }}
                        onDragStart={(event) => {
                          event.cancelBubble = true;
                        }}
                        onDragMove={(event) => handleDirectionalHandleDrag(selectedDirectionalShape.id, endpoint, event, false)}
                        onDragEnd={(event) => handleDirectionalHandleDrag(selectedDirectionalShape.id, endpoint, event, true)}
                      />
                    );

                    return (
                      <>
                        {renderHandle("start", endpoints.start)}
                        {renderHandle("end", endpoints.end)}
                      </>
                    );
                  })()
                : null}
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
                          strokeColor: draft.type === "frame" ? frameStroke : defaultStyle.stroke,
                          strokeWidth:
                            draft.type === "frame" ? initialDefaultStyle.strokeWidth : defaultStyle.strokeWidth,
                          fillColor: defaultStyle.stroke,
                          fillStyle: getCanvasPropertiesSections(draft.type)?.preenchimento
                            ? defaultStyle.fillStyle
                            : "none",
                          rotation: 0,
                          text: "",
                          textColor: defaultStyle.stroke,
                          fontSize: textDefaultFontSize,
                          fontFamily: canvasUiFontFamily,
                          image: null,
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
                  stroke={initialDefaultStyle.stroke}
                  strokeWidth={1}
                  dash={[4, 4]}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              ) : null}
              <Transformer
                ref={transformerRef}
                enabledAnchors={
                  isTextTransformer
                    ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                    : [
                        "top-left",
                        "top-center",
                        "top-right",
                        "middle-left",
                        "middle-right",
                        "bottom-left",
                        "bottom-center",
                        "bottom-right",
                      ]
                }
                keepRatio={isTextTransformer}
                shiftBehavior={isTextTransformer ? "none" : "default"}
                flipEnabled={!isTextTransformer}
                rotateEnabled
                rotationSnaps={[]}
                ignoreStroke
                boundBoxFunc={handleTransformerBoundBox}
              />
            </Layer>
          </Stage>
          {imageError ? (
            <p
              role="alert"
              className="pointer-events-none absolute left-1/2 top-3 z-20 -translate-x-1/2 rounded-lg bg-status-red px-3 py-2 text-sm font-semibold text-status-red-text shadow-md"
            >
              {imageError}
            </p>
          ) : null}
          {editingText
            ? (() => {
                const shape = shapes.find((candidate) => candidate.id === editingText.id && candidate.type === "text");
                const stage = stageRef.current;
                if (!shape || !stage) {
                  return null;
                }
                const scale = stage.scaleX() || 1;
                return (
                  <textarea
                    ref={textAreaRef}
                    aria-label="Editar texto do quadro"
                    wrap="off"
                    rows={1}
                    spellCheck
                    value={editingText.value}
                    onChange={(event) => {
                      const nextEditing = { id: editingText.id, value: event.target.value };
                      editingTextRef.current = nextEditing;
                      setEditingText(nextEditing);
                    }}
                    onBlur={finishTextEditing}
                    onKeyDown={(event) => {
                      if (event.key !== "Escape") {
                        return;
                      }
                      event.preventDefault();
                      event.stopPropagation();
                      finishTextEditing();
                    }}
                    style={{
                      position: "absolute",
                      left: stage.x() + shape.x * scale,
                      top: stage.y() + shape.y * scale,
                      minWidth: shape.fontSize * scale,
                      margin: 0,
                      padding: 0,
                      border: 0,
                      outline: 0,
                      resize: "none",
                      overflow: "hidden",
                      background: "transparent",
                      color: shape.stroke,
                      fontFamily: canvasUiFontFamily,
                      fontSize: shape.fontSize * scale,
                      lineHeight: textLineHeight,
                      whiteSpace: "pre",
                      transform: shape.rotation === 0 ? undefined : `rotate(${shape.rotation}deg)`,
                      transformOrigin: "top left",
                      zIndex: 10,
                    }}
                  />
                );
              })()
            : null}
          {propertiesSections ? (
            <CanvasPropertiesPanel
              sections={propertiesSections}
              color={propertiesStyle.stroke}
              strokeWidth={propertiesStyle.strokeWidth}
              fillStyle={propertiesStyle.fillStyle}
              onColorChange={handlePropertiesColorChange}
              onStrokeWidthChange={handlePropertiesStrokeWidthChange}
              onFillStyleChange={handlePropertiesFillStyleChange}
            />
          ) : null}
          <CanvasToolbar tool={tool} onSelectTool={setTool} onTogglePan={togglePan} />
        </div>
      )}
    </FloatingPanelFrame>
  );
}
