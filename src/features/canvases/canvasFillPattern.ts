import type { CanvasFillStyle } from "./canvasScene";

export type CanvasPatternFillStyle = Extract<CanvasFillStyle, "hachure" | "cross-hatch">;

const tileSize = 8;
const patternCache = new Map<string, HTMLCanvasElement>();

function addLine(context: CanvasRenderingContext2D, startX: number, startY: number, endX: number, endY: number) {
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
}

export function getFillPatternImage(style: CanvasPatternFillStyle, color: string): HTMLCanvasElement {
  const cacheKey = `${style}:${color}`;
  const cached = patternCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const canvas = document.createElement("canvas");
  canvas.width = tileSize;
  canvas.height = tileSize;
  const context = canvas.getContext("2d");

  if (context) {
    context.strokeStyle = color;
    context.lineWidth = 1;
    context.beginPath();

    // Segmentos que ultrapassam as bordas fecham sem emenda quando o tile repete.
    addLine(context, -tileSize, 0, 0, tileSize);
    addLine(context, 0, 0, tileSize, tileSize);
    addLine(context, tileSize, 0, tileSize * 2, tileSize);

    if (style === "cross-hatch") {
      addLine(context, -tileSize, tileSize, 0, 0);
      addLine(context, 0, tileSize, tileSize, 0);
      addLine(context, tileSize, tileSize, tileSize * 2, 0);
    }

    context.stroke();
  }

  patternCache.set(cacheKey, canvas);
  return canvas;
}
