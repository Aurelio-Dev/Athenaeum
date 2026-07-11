export type CanvasTransformBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type FinalCanvasTransform = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

export type FinalFreedrawTransform = FinalCanvasTransform & {
  points: number[];
};

const minimumTransformedSize = 4;

export function getCanvasPointsSize(points: number[]): { width: number; height: number } {
  if (points.length < 2) {
    return { width: minimumTransformedSize, height: minimumTransformedSize };
  }

  let minX = points[0];
  let maxX = points[0];
  let minY = points[1];
  let maxY = points[1];
  for (let index = 2; index + 1 < points.length; index += 2) {
    minX = Math.min(minX, points[index]);
    maxX = Math.max(maxX, points[index]);
    minY = Math.min(minY, points[index + 1]);
    maxY = Math.max(maxY, points[index + 1]);
  }

  return {
    width: Math.max(minimumTransformedSize, maxX - minX),
    height: Math.max(minimumTransformedSize, maxY - minY),
  };
}

// Em tracos livres, os pontos relativos sao a fonte da verdade. Incorporar a
// escala em cada par preserva a nuvem inteira, inclusive espelhamentos, e deixa
// o node pronto para voltar a scaleX/scaleY = 1 sem double scaling.
export function finalizeFreedrawTransform({
  x,
  y,
  points,
  scaleX,
  scaleY,
  rotation,
}: {
  x: number;
  y: number;
  points: number[];
  scaleX: number;
  scaleY: number;
  rotation: number;
}): FinalFreedrawTransform {
  const scaledPoints: number[] = [];
  for (let index = 0; index + 1 < points.length; index += 2) {
    const scaledX = points[index] * scaleX;
    const scaledY = points[index + 1] * scaleY;
    scaledPoints.push(scaledX === 0 ? 0 : scaledX, scaledY === 0 ? 0 : scaledY);
  }
  const size = getCanvasPointsSize(scaledPoints);

  return {
    x,
    y,
    width: size.width,
    height: size.height,
    points: scaledPoints,
    rotation,
  };
}

// Converte a escala temporaria do Konva em dimensoes persistiveis. Quando um
// eixo foi invertido, desloca a origem ao longo dos eixos ja rotacionados para
// manter a mesma caixa visual com width/height positivos.
export function finalizeCanvasTransform({
  x,
  y,
  width,
  height,
  scaleX,
  scaleY,
  rotation,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}): FinalCanvasTransform {
  const signedWidth = width * scaleX;
  const signedHeight = height * scaleY;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  let normalizedX = x;
  let normalizedY = y;
  if (signedWidth < 0) {
    normalizedX += cos * signedWidth;
    normalizedY += sin * signedWidth;
  }
  if (signedHeight < 0) {
    normalizedX -= sin * signedHeight;
    normalizedY += cos * signedHeight;
  }

  return {
    x: normalizedX,
    y: normalizedY,
    width: Math.max(minimumTransformedSize, Math.abs(signedWidth)),
    height: Math.max(minimumTransformedSize, Math.abs(signedHeight)),
    rotation,
  };
}

// O Konva aplica Shift proporcionalmente nos handles de canto, mas nao nos
// handles centrais. Nestes quatro casos, ajusta a dimensao perpendicular em
// torno do centro, preservando o lado oposto e a rotacao da caixa.
export function lockSideAnchorAspectRatio(
  box: CanvasTransformBox,
  activeAnchor: string | null,
  aspectRatio: number,
): CanvasTransformBox {
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    return box;
  }

  const cos = Math.cos(box.rotation);
  const sin = Math.sin(box.rotation);

  if (activeAnchor === "middle-left" || activeAnchor === "middle-right") {
    const nextHeight = (Math.sign(box.height) || 1) * (Math.abs(box.width) / aspectRatio);
    const localOffsetY = (box.height - nextHeight) / 2;
    return {
      ...box,
      x: box.x - sin * localOffsetY,
      y: box.y + cos * localOffsetY,
      height: nextHeight,
    };
  }

  if (activeAnchor === "top-center" || activeAnchor === "bottom-center") {
    const nextWidth = (Math.sign(box.width) || 1) * (Math.abs(box.height) * aspectRatio);
    const localOffsetX = (box.width - nextWidth) / 2;
    return {
      ...box,
      x: box.x + cos * localOffsetX,
      y: box.y + sin * localOffsetX,
      width: nextWidth,
    };
  }

  return box;
}
