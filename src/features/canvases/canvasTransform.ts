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

const minimumTransformedSize = 4;

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
