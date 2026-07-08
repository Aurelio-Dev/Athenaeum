// Dimensoes independentes de figuras de imagem.
//
// Exclusivo de imagens (data-figure-subtype="image"). Diagramas e equacoes
// continuam usando a escala proporcional unica de notebookDiagramScale.ts.
//
// Formato persistido: dois atributos numericos dedicados, em PIXELS CSS
// inteiros, sempre gravados juntos:
//   data-figure-width
//   data-figure-height
//
// Escolha de unidade e limites: pixels permitem aplicar largura e altura de
// forma deterministica na exportacao (que nao conhece o tamanho intrinseco do
// arquivo), enquanto o tamanho renderizado real e sempre limitado por
// max-width:100% no editor e no export. O teto aqui e apenas um limite de
// sanidade contra valores absurdos; a degradacao responsiva fica com o CSS.
//
// Compatibilidade: figura sem os atributos = tamanho natural; figura so com o
// data-figure-scale legado continua proporcional; a conversao para o novo
// formato so acontece num resize real (nunca ao apenas abrir a pagina).

import { getExportScaleWidthPercent } from "./notebookDiagramScale";

export const figureMinDimensionPx = 48;
export const figureMaxDimensionPx = 4096;

export const figureWidthAttributeName = "data-figure-width";
export const figureHeightAttributeName = "data-figure-height";

export type FigureDimensions = {
  width: number;
  height: number;
};

// Aceita apenas inteiros positivos dentro do intervalo. Vazio, NaN, negativo,
// infinito, fracionario, fora do range ou texto viram null (estado seguro).
export function parseFigureDimension(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < figureMinDimensionPx || parsed > figureMaxDimensionPx) {
    return null;
  }

  return parsed;
}

// Clampa e arredonda para o intervalo valido; nao-finito cai no minimo.
export function clampFigureDimension(value: number): number {
  if (!Number.isFinite(value)) {
    return figureMinDimensionPx;
  }

  return Math.min(figureMaxDimensionPx, Math.max(figureMinDimensionPx, Math.round(value)));
}

export function serializeFigureDimension(value: number): string {
  return String(clampFigureDimension(value));
}

// As duas dimensoes precisam ser validas juntas: se qualquer uma faltar ou for
// invalida, a figura nao tem dimensoes independentes (tamanho natural/legado).
export function parseFigureDimensions(
  widthValue: string | null | undefined,
  heightValue: string | null | undefined,
): FigureDimensions | null {
  const width = parseFigureDimension(widthValue);
  const height = parseFigureDimension(heightValue);
  if (width === null || height === null) {
    return null;
  }

  return { width, height };
}

export function isFigureDimensionAttribute(name: string): boolean {
  return name === figureWidthAttributeName || name === figureHeightAttributeName;
}

// Escreve/remove os atributos como par atomico: dimensoes validas gravam ambos;
// null remove ambos (volta ao tamanho natural).
export function applyFigureDimensions(figure: HTMLElement, dimensions: FigureDimensions | null) {
  if (dimensions === null) {
    delete figure.dataset.figureWidth;
    delete figure.dataset.figureHeight;
    return;
  }

  figure.dataset.figureWidth = serializeFigureDimension(dimensions.width);
  figure.dataset.figureHeight = serializeFigureDimension(dimensions.height);
}

export function readFigureDimensions(figure: HTMLElement): FigureDimensions | null {
  return parseFigureDimensions(figure.dataset.figureWidth, figure.dataset.figureHeight);
}

// Sanitizacao unica para persistencia/export/paste: mantem so o par valido,
// senao remove os dois. Fonte de verdade de "quais dimensoes sobrevivem".
export function setSanitizedFigureDimensionAttributes(
  target: HTMLElement,
  widthValue: string | null | undefined,
  heightValue: string | null | undefined,
) {
  applyFigureDimensions(target, parseFigureDimensions(widthValue, heightValue));
}

// Interpreta uma escala proporcional legada como largura/altura equivalentes,
// a partir do tamanho natural medido. Usado ao migrar no primeiro resize e para
// exibir a imagem legada com o mesmo tamanho aproximado no editor.
export function figureDimensionsFromScale(
  scalePercent: number,
  naturalWidth: number,
  naturalHeight: number,
): FigureDimensions | null {
  if (!Number.isFinite(scalePercent) || naturalWidth <= 0 || naturalHeight <= 0) {
    return null;
  }

  const factor = scalePercent / 100;
  return {
    width: clampFigureDimension(naturalWidth * factor),
    height: clampFigureDimension(naturalHeight * factor),
  };
}

// -- Geometria pura do resize livre (8 areas) ------------------------------

export type ImageResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const imageResizeHandles: readonly ImageResizeHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Direcao de contribuicao de cada handle: laterais mexem so num eixo, cantos
// nos dois. O sinal indica se o eixo cresce (1), encolhe (-1) ou nao muda (0)
// para um delta de ponteiro positivo.
const handleWidthDirection: Record<ImageResizeHandle, -1 | 0 | 1> = {
  w: -1,
  nw: -1,
  sw: -1,
  e: 1,
  ne: 1,
  se: 1,
  n: 0,
  s: 0,
};

const handleHeightDirection: Record<ImageResizeHandle, -1 | 0 | 1> = {
  n: -1,
  ne: -1,
  nw: -1,
  s: 1,
  se: 1,
  sw: 1,
  e: 0,
  w: 0,
};

export function isImageCornerHandle(handle: ImageResizeHandle): boolean {
  return handleWidthDirection[handle] !== 0 && handleHeightDirection[handle] !== 0;
}

export type ImageResizeInput = {
  handle: ImageResizeHandle;
  startWidth: number;
  startHeight: number;
  deltaX: number;
  deltaY: number;
  // Trava a proporcao inicial (Shift) — so tem efeito nos cantos.
  preserveAspect: boolean;
  // Teto opcional de largura (largura util do editor), para nunca estourar o
  // layout; com aspecto travado a altura acompanha.
  maxWidth?: number | null;
};

// Calcula largura e altura a partir do handle e do deslocamento do ponteiro.
// Laterais alteram um unico eixo; cantos alteram os dois de forma independente
// (aspecto livre) ou travados na proporcao inicial quando preserveAspect. O
// resultado sempre sai clampado ao intervalo valido — nunca zero ou negativo.
export function computeImageResize(input: ImageResizeInput): FigureDimensions {
  const widthDirection = handleWidthDirection[input.handle];
  const heightDirection = handleHeightDirection[input.handle];

  let width = input.startWidth + widthDirection * input.deltaX;
  let height = input.startHeight + heightDirection * input.deltaY;

  const isCorner = isImageCornerHandle(input.handle);
  if (input.preserveAspect && isCorner && input.startWidth > 0 && input.startHeight > 0) {
    const aspect = input.startWidth / input.startHeight;
    const widthChange = Math.abs(width - input.startWidth) / input.startWidth;
    const heightChange = Math.abs(height - input.startHeight) / input.startHeight;
    if (widthChange >= heightChange) {
      height = width / aspect;
    } else {
      width = height * aspect;
    }
  }

  const maxWidth = input.maxWidth ?? null;
  if (maxWidth !== null && Number.isFinite(maxWidth) && maxWidth > 0 && width > maxWidth) {
    if (input.preserveAspect && isCorner && width > 0) {
      height = height * (maxWidth / width);
    }
    width = maxWidth;
  }

  return {
    width: clampFigureDimension(width),
    height: clampFigureDimension(height),
  };
}

// -- Decisao pura de dimensionamento na exportacao -------------------------

export type FigureExportSizing =
  | { kind: "natural" }
  | { kind: "scale"; percent: number }
  | { kind: "dimensions"; width: number; height: number };

// As novas dimensoes tem prioridade sobre a escala legada. Escala valida vira
// largura proporcional (comportamento antigo). Qualquer entrada invalida cai em
// "natural" (tamanho natural, sem estilo injetado).
export function resolveFigureExportSizing(
  widthValue: string | null | undefined,
  heightValue: string | null | undefined,
  scaleValue: string | null | undefined,
): FigureExportSizing {
  const dimensions = parseFigureDimensions(widthValue, heightValue);
  if (dimensions) {
    return { kind: "dimensions", width: dimensions.width, height: dimensions.height };
  }

  const scalePercent = getExportScaleWidthPercent(scaleValue);
  if (scalePercent !== null) {
    return { kind: "scale", percent: scalePercent };
  }

  return { kind: "natural" };
}
