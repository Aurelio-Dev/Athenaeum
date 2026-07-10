// Borracha do Quadro: logica pura de apagamento por segmento, sem dependencia
// de React/Konva — testavel em unidade.
//
// A cada tick de movimento do cursor, a borracha percorre o segmento
// posicao-anterior -> posicao-atual (em coordenadas do mundo do stage) com um
// raio de alcance. Formas rigidas (rect/diamond/ellipse/arrow/line) sao
// removidas inteiras quando tocadas; tracos de lapis (freedraw) sao cortados
// ponto a ponto, podendo se dividir em varios tracos menores.

import { createShapeId, diamondPoints, type CanvasShape } from "./canvasScene";

type Point = { x: number; y: number };

// Distancia de um ponto ao SEGMENTO ab (nao a reta infinita): projeta o ponto
// na reta e limita o parametro t a [0, 1]. Usar o segmento inteiro — e nao so
// os extremos — evita "pular" formas quando o cursor anda rapido entre dois
// eventos de mousemove.
function distancePointToSegment(point: Point, a: Point, b: Point): number {
  const abX = b.x - a.x;
  const abY = b.y - a.y;
  const lengthSquared = abX * abX + abY * abY;

  // Segmento degenerado (from === to): distancia ponto a ponto.
  if (lengthSquared === 0) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - a.x) * abX + (point.y - a.y) * abY) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * abX), point.y - (a.y + t * abY));
}

// Amostra pontos ao longo de uma polilinha (vertices em coordenadas absolutas),
// subdividindo cada aresta em passos de ~step para nenhum trecho longo ficar
// sem amostra entre dois vertices.
function samplePolyline(vertices: Point[], closed: boolean, step: number): Point[] {
  const samples: Point[] = [];
  const count = vertices.length;
  if (count === 0) {
    return samples;
  }

  const segmentCount = closed ? count : count - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const a = vertices[index];
    const b = vertices[(index + 1) % count];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const divisions = Math.max(1, Math.ceil(length / step));
    // t < 1: o fim de cada aresta e o inicio da proxima (sem duplicar amostras).
    for (let division = 0; division < divisions; division += 1) {
      const t = division / divisions;
      samples.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  // Em polilinhas abertas o laco acima exclui o ultimo vertice; inclui aqui.
  if (!closed) {
    samples.push(vertices[count - 1]);
  }

  return samples;
}

// Pontos de amostra ao longo do contorno de uma forma rigida, em coordenadas
// absolutas. Replica a MESMA geometria que renderCanvasShape monta na tela:
// - rect: os 4 cantos da caixa (node Rect);
// - diamond: diamondPoints, a fonte unica da geometria do losango;
// - ellipse: parametrica com centro/raios da caixa (como o node Ellipse);
// - arrow/line: points relativos a (x, y), convencao da Fase 3A.
// rotation e ignorada de proposito: e sempre 0 ate os handles de rotate
// entrarem (Fase 4); quando entrarem, aplicar a rotacao aqui tambem.
function sampleShapeOutline(shape: CanvasShape, step: number): Point[] {
  switch (shape.type) {
    case "rect":
    case "text":
    case "image":
    case "frame": {
      const vertices = [
        { x: shape.x, y: shape.y },
        { x: shape.x + shape.width, y: shape.y },
        { x: shape.x + shape.width, y: shape.y + shape.height },
        { x: shape.x, y: shape.y + shape.height },
      ];
      return samplePolyline(vertices, true, step);
    }
    case "diamond": {
      const flat = diamondPoints(shape.width, shape.height);
      const vertices: Point[] = [];
      for (let index = 0; index + 1 < flat.length; index += 2) {
        vertices.push({ x: shape.x + flat[index], y: shape.y + flat[index + 1] });
      }
      return samplePolyline(vertices, true, step);
    }
    case "ellipse": {
      const radiusX = shape.width / 2;
      const radiusY = shape.height / 2;
      const centerX = shape.x + radiusX;
      const centerY = shape.y + radiusY;
      // Quantidade de amostras proporcional ao perimetro aproximado, com um
      // piso para elipses pequenas nao ficarem sub-amostradas.
      const approximatePerimeter = Math.PI * (radiusX + radiusY);
      const sampleCount = Math.max(12, Math.ceil(approximatePerimeter / step));
      const samples: Point[] = [];
      for (let index = 0; index < sampleCount; index += 1) {
        const angle = (index / sampleCount) * Math.PI * 2;
        samples.push({ x: centerX + Math.cos(angle) * radiusX, y: centerY + Math.sin(angle) * radiusY });
      }
      return samples;
    }
    case "arrow":
    case "line":
    case "freedraw": {
      // freedraw nao passa por aqui (tem corte proprio em eraseFreedraw), mas o
      // case mantem o switch exaustivo e coerente caso a rotina seja reusada.
      const vertices: Point[] = [];
      for (let index = 0; index + 1 < shape.points.length; index += 2) {
        vertices.push({ x: shape.x + shape.points[index], y: shape.y + shape.points[index + 1] });
      }
      return samplePolyline(vertices, false, step);
    }
  }
}

// Corta um traco de lapis: pontos dentro do alcance da borracha sao apagados e
// as sequencias contiguas restantes ("runs") viram tracos independentes, com a
// mesma convencao de ancora do lapis (x/y = primeiro ponto, points relativos).
// Retorna null quando nenhum ponto foi apagado (traco intocado).
function eraseFreedraw(shape: CanvasShape, from: Point, to: Point, radius: number): CanvasShape[] | null {
  const absolute: Point[] = [];
  for (let index = 0; index + 1 < shape.points.length; index += 2) {
    absolute.push({ x: shape.x + shape.points[index], y: shape.y + shape.points[index + 1] });
  }

  const kept = absolute.map((point) => distancePointToSegment(point, from, to) > radius);
  if (kept.every(Boolean)) {
    return null;
  }

  // Agrupa os pontos mantidos em sequencias contiguas.
  const runs: Point[][] = [];
  let currentRun: Point[] = [];
  absolute.forEach((point, index) => {
    if (kept[index]) {
      currentRun.push(point);
      return;
    }
    if (currentRun.length > 0) {
      runs.push(currentRun);
      currentRun = [];
    }
  });
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }

  const fragments: CanvasShape[] = [];
  for (const run of runs) {
    // Um ponto sozinho seria um traco degenerado/invisivel: descartado (mesma
    // regra minima do parser de freedraw).
    if (run.length < 2) {
      continue;
    }

    const anchor = run[0];
    let minX = anchor.x;
    let maxX = anchor.x;
    let minY = anchor.y;
    let maxY = anchor.y;
    const relativePoints: number[] = [];
    for (const point of run) {
      relativePoints.push(point.x - anchor.x, point.y - anchor.y);
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }

    // Preserva estilo (stroke/strokeWidth/fill) e rotation do traco original.
    fragments.push({
      ...shape,
      id: createShapeId(),
      x: anchor.x,
      y: anchor.y,
      width: maxX - minX,
      height: maxY - minY,
      points: relativePoints,
    });
  }

  return fragments;
}

// Aplica um tick da borracha sobre o array de formas. Formas rigidas tocadas
// pelo segmento (dentro do raio) sao removidas inteiras; tracos de lapis sao
// cortados em fragmentos. Retorna o MESMO array (mesma referencia) quando nada
// foi tocado — o chamador usa isso para evitar re-render e save desnecessarios.
export function eraseAlongSegment(
  shapes: CanvasShape[],
  from: Point,
  to: Point,
  radius: number,
): CanvasShape[] {
  // Passo de amostragem <= raio: duas amostras vizinhas nunca ficam mais
  // distantes que o alcance, entao nenhum trecho de contorno passa despercebido.
  const step = Math.max(2, radius);
  let changed = false;
  const result: CanvasShape[] = [];

  for (const shape of shapes) {
    if (shape.type === "freedraw") {
      const fragments = eraseFreedraw(shape, from, to, radius);
      if (fragments === null) {
        result.push(shape);
      } else {
        changed = true;
        result.push(...fragments);
      }
      continue;
    }

    const touched = sampleShapeOutline(shape, step).some(
      (sample) => distancePointToSegment(sample, from, to) <= radius,
    );
    if (touched) {
      changed = true;
    } else {
      result.push(shape);
    }
  }

  return changed ? result : shapes;
}
