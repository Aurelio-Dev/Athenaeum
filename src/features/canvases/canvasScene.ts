// Tipos e parser do conteudo do Quadro (engine Konva).
//
// Esta e a fonte da verdade do formato persistido em canvases.content. O blob
// e um JSON pequeno que muda a cada edicao (mover um retangulo ja gera save);
// imagens NAO entram aqui — vivem em disco via canvas_files (comando Rust).
//
// Historia: ate a Fase 1 o Quadro usava Excalidraw, cujo content era
// {elements, appState}. A migracao para Konva troca o formato; parseCanvasContent
// abaixo trata o conteudo antigo (e qualquer conteudo corrompido) abrindo uma
// cena vazia, sem lancar erro.

// Tipos de forma suportados. Todos compartilham os mesmos campos (sem campos
// exclusivos por tipo por enquanto): as formas de caixa (rect, diamond, ellipse)
// usam x/y/width/height; as direcionais (arrow, line) usam x/y como ancora e
// points ([x1, y1, x2, y2]) relativos a x/y.
export type CanvasShapeType = "rect" | "diamond" | "ellipse" | "arrow" | "line";

export type CanvasShape = {
  id: string;
  type: CanvasShapeType;
  x: number;
  y: number;
  width: number;
  height: number;
  // Pontos relativos a (x, y). Usado por "arrow" e "line" ([x1, y1, x2, y2]);
  // vazio nas formas de caixa (rect, diamond, ellipse), que usam width/height.
  points: number[];
  rotation: number;
  stroke: string;
  strokeWidth: number;
  fill: string | null;
};

export type CanvasSceneContent = {
  engine: "konva";
  schemaVersion: 1;
  stage: { x: number; y: number; scale: number };
  shapes: CanvasShape[];
};

// Traco padrao das formas novas (marrom da paleta do app).
const defaultStroke = "#2C1A10";
const defaultStrokeWidth = 2;

// Cena vazia valida. Retornada como fallback seguro sempre que o conteudo
// persistido nao puder ser interpretado no formato Konva atual.
export function createEmptyScene(): CanvasSceneContent {
  return {
    engine: "konva",
    schemaVersion: 1,
    stage: { x: 0, y: 0, scale: 1 },
    shapes: [],
  };
}

// String canonica de uma cena vazia — usada no INSERT de Quadro novo para nao
// depender do DEFAULT antigo (Excalidraw) da coluna canvases.content.
export const emptyCanvasContentJson = JSON.stringify(createEmptyScene());

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Numero finito ou fallback. Descarta NaN/Infinity vindos de conteudo corrompido.
function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

const canvasShapeTypes: readonly CanvasShapeType[] = ["rect", "diamond", "ellipse", "arrow", "line"];

function isCanvasShapeType(value: unknown): value is CanvasShapeType {
  return typeof value === "string" && (canvasShapeTypes as readonly string[]).includes(value);
}

// Lista de pontos [x1, y1, x2, y2, ...]. Qualquer elemento invalido descarta a
// lista inteira (all-or-nothing) para nao renderizar uma geometria parcial.
function parsePoints(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const points: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isFinite(item)) {
      return [];
    }
    points.push(item);
  }
  return points;
}

function parseStage(value: unknown): CanvasSceneContent["stage"] {
  if (!isRecord(value)) {
    return { x: 0, y: 0, scale: 1 };
  }

  const scale = finiteNumber(value.scale, 1);
  return {
    x: finiteNumber(value.x, 0),
    y: finiteNumber(value.y, 0),
    // Escala nao positiva colapsaria o desenho; cai no 1 seguro.
    scale: scale > 0 ? scale : 1,
  };
}

// Valida uma forma individual. Retorna null quando faltam campos essenciais
// (id, tipo conhecido, geometria numerica) para que a cena resultante seja
// sempre renderizavel.
function parseShape(value: unknown): CanvasShape | null {
  if (!isRecord(value)) {
    return null;
  }

  if (!isCanvasShapeType(value.type)) {
    return null;
  }

  if (typeof value.id !== "string" || value.id.length === 0) {
    return null;
  }

  const x = finiteNumber(value.x, Number.NaN);
  const y = finiteNumber(value.y, Number.NaN);
  const width = finiteNumber(value.width, Number.NaN);
  const height = finiteNumber(value.height, Number.NaN);

  if (![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  const points = parsePoints(value.points);

  // Seta e linha sao direcionais: sem os dois pontos ([x1, y1, x2, y2]) a forma
  // e degenerada e nao teria o que renderizar.
  if ((value.type === "arrow" || value.type === "line") && points.length < 4) {
    return null;
  }

  return {
    id: value.id,
    type: value.type,
    x,
    y,
    width,
    height,
    points,
    rotation: finiteNumber(value.rotation, 0),
    stroke: typeof value.stroke === "string" ? value.stroke : defaultStroke,
    strokeWidth: finiteNumber(value.strokeWidth, defaultStrokeWidth),
    fill: typeof value.fill === "string" ? value.fill : null,
  };
}

function parseShapes(value: unknown): CanvasShape[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const shapes: CanvasShape[] = [];
  for (const item of value) {
    const shape = parseShape(item);
    if (shape) {
      shapes.push(shape);
    }
  }
  return shapes;
}

// Interpreta o content persistido de um Quadro. NUNCA lanca: qualquer falha
// (JSON invalido, engine ausente/diferente, schemaVersion diferente, conteudo
// antigo do Excalidraw) resulta numa cena vazia valida. Isso mantem o Quadro
// sempre abrivel — confiabilidade acima de tudo.
export function parseCanvasContent(raw: string): CanvasSceneContent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return createEmptyScene();
  }

  if (!isRecord(parsed)) {
    return createEmptyScene();
  }

  // Conteudo antigo do Excalidraw ({elements, appState}) cai aqui: nao tem
  // engine "konva" nem schemaVersion 1.
  if (parsed.engine !== "konva" || parsed.schemaVersion !== 1) {
    return createEmptyScene();
  }

  return {
    engine: "konva",
    schemaVersion: 1,
    stage: parseStage(parsed.stage),
    shapes: parseShapes(parsed.shapes),
  };
}
