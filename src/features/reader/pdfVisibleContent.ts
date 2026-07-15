import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { fullPageContentBounds, type NormalizedContentBounds } from "./readerView";

const alphaThreshold = 8;
const maximumAnalysisPixels = 750_000;
const maximumAnalysisSide = 1600;

type Rgba = readonly [number, number, number, number];

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }

  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.floor(ordered.length / 2)] ?? 0;
}

function colorDistance(pixel: Rgba, background: Rgba) {
  return Math.max(
    Math.abs(pixel[0] - background[0]),
    Math.abs(pixel[1] - background[1]),
    Math.abs(pixel[2] - background[2]),
    Math.abs(pixel[3] - background[3]),
  );
}

function getBorderSamples(data: Uint8ClampedArray, width: number, height: number) {
  const samples: Rgba[] = [];
  const horizontalStep = Math.max(1, Math.floor(width / 32));
  const verticalStep = Math.max(1, Math.floor(height / 32));

  function add(x: number, y: number) {
    const index = (y * width + x) * 4;
    samples.push([data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0, data[index + 3] ?? 0]);
  }

  for (let x = 0; x < width; x += horizontalStep) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = verticalStep; y < height - verticalStep; y += verticalStep) {
    add(0, y);
    add(width - 1, y);
  }

  return samples;
}

export function detectVisibleContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): NormalizedContentBounds {
  if (width <= 1 || height <= 1 || data.length < width * height * 4) {
    return fullPageContentBounds;
  }

  let opaquePixels = 0;
  const pixelCount = width * height;
  for (let index = 3; index < data.length; index += 4) {
    if ((data[index] ?? 0) > alphaThreshold) {
      opaquePixels += 1;
    }
  }

  if (opaquePixels === 0) {
    return fullPageContentBounds;
  }

  const opaqueRatio = opaquePixels / pixelCount;
  const useAlphaMask = opaqueRatio < 0.92;
  let background: Rgba = [0, 0, 0, 0];
  let backgroundThreshold = 0;

  if (!useAlphaMask) {
    const samples = getBorderSamples(data, width, height).filter((sample) => sample[3] > alphaThreshold);
    if (samples.length < 8) {
      return fullPageContentBounds;
    }

    background = [
      median(samples.map((sample) => sample[0])),
      median(samples.map((sample) => sample[1])),
      median(samples.map((sample) => sample[2])),
      median(samples.map((sample) => sample[3])),
    ];
    const distances = samples.map((sample) => colorDistance(sample, background)).sort((left, right) => left - right);
    const percentile95 = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.95))] ?? 0;

    // Uma moldura heterogenea indica foto/arte full-bleed. Nesse caso, cortar
    // por cor seria uma suposicao arriscada; o fallback integral e deliberado.
    if (percentile95 > 42) {
      return fullPageContentBounds;
    }
    backgroundThreshold = Math.min(48, Math.max(18, percentile95 + 10));
  }

  const mask = new Uint8Array(pixelCount);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    const alpha = data[dataIndex + 3] ?? 0;
    const distanceFromBackground = useAlphaMask
      ? 0
      : Math.max(
          Math.abs((data[dataIndex] ?? 0) - background[0]),
          Math.abs((data[dataIndex + 1] ?? 0) - background[1]),
          Math.abs((data[dataIndex + 2] ?? 0) - background[2]),
          Math.abs(alpha - background[3]),
        );
    const isContent = useAlphaMask
      ? alpha > alphaThreshold
      : alpha > alphaThreshold && distanceFromBackground > backgroundThreshold;
    mask[pixelIndex] = isContent ? 1 : 0;
  }

  const rowCounts = new Uint32Array(height);
  const columnCounts = new Uint32Array(width);
  let connectedPixels = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (mask[index] === 0) {
        continue;
      }

      let hasNeighbor = false;
      for (let offsetY = -1; offsetY <= 1 && !hasNeighbor; offsetY += 1) {
        const neighborY = y + offsetY;
        if (neighborY < 0 || neighborY >= height) {
          continue;
        }
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          const neighborX = x + offsetX;
          if (neighborX >= 0 && neighborX < width && mask[neighborY * width + neighborX] === 1) {
            hasNeighbor = true;
            break;
          }
        }
      }

      if (hasNeighbor) {
        rowCounts[y] += 1;
        columnCounts[x] += 1;
        connectedPixels += 1;
      }
    }
  }

  if (connectedPixels < Math.max(12, Math.floor(pixelCount * 0.00001))) {
    return fullPageContentBounds;
  }

  const minimumRowPixels = Math.max(1, Math.floor(width * 0.001));
  const minimumColumnPixels = Math.max(1, Math.floor(height * 0.001));
  let left = 0;
  let right = width - 1;
  let top = 0;
  let bottom = height - 1;

  while (left < width && columnCounts[left] < minimumColumnPixels) left += 1;
  while (right >= left && columnCounts[right] < minimumColumnPixels) right -= 1;
  while (top < height && rowCounts[top] < minimumRowPixels) top += 1;
  while (bottom >= top && rowCounts[bottom] < minimumRowPixels) bottom -= 1;

  if (right - left < 2 || bottom - top < 2) {
    return fullPageContentBounds;
  }

  const horizontalPadding = Math.max(4, Math.round(width * 0.018));
  const verticalPadding = Math.max(4, Math.round(height * 0.018));
  left = Math.max(0, left - horizontalPadding);
  right = Math.min(width - 1, right + horizontalPadding);
  top = Math.max(0, top - verticalPadding);
  bottom = Math.min(height - 1, bottom + verticalPadding);

  return {
    left: left / width,
    top: top / height,
    right: (right + 1) / width,
    bottom: (bottom + 1) / height,
    confidence: useAlphaMask ? "high" : "medium",
  };
}

export async function analyzePdfPageVisibleContent(
  page: PDFPageProxy,
  signal?: AbortSignal,
): Promise<NormalizedContentBounds> {
  const baseViewport = page.getViewport({ scale: 1 });
  const areaScale = Math.sqrt(maximumAnalysisPixels / Math.max(1, baseViewport.width * baseViewport.height));
  const sideScale = maximumAnalysisSide / Math.max(1, baseViewport.width, baseViewport.height);
  const analysisScale = Math.min(2, areaScale, sideScale);
  const viewport = page.getViewport({ scale: analysisScale });
  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  const canvas = window.document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: true, willReadFrequently: true });

  if (!context) {
    return fullPageContentBounds;
  }

  let renderTask: RenderTask | null = null;
  const cancelRender = () => renderTask?.cancel();
  signal?.addEventListener("abort", cancelRender, { once: true });

  try {
    if (signal?.aborted) {
      throw new DOMException("Analise cancelada.", "AbortError");
    }

    renderTask = page.render({
      canvasContext: context,
      viewport,
      intent: "display",
      background: "rgba(0,0,0,0)",
    });
    await renderTask.promise;

    if (signal?.aborted) {
      throw new DOMException("Analise cancelada.", "AbortError");
    }

    const imageData = context.getImageData(0, 0, width, height);
    return detectVisibleContentBounds(imageData.data, width, height);
  } finally {
    signal?.removeEventListener("abort", cancelRender);
    canvas.width = 0;
    canvas.height = 0;
  }
}
