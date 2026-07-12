export type CurveDirection = { x: number; y: number };

export const canvasDirectionalCurveTension = 0.5;

export function getDirectionalTension(points: number[]): number {
  return points.length === 6 ? canvasDirectionalCurveTension : 0;
}

// Replica getControlPoints() de Konva 10.3.0. O metodo e privado em
// shapes/Line.js; manter a formula aqui evita depender de uma API interna.
export function getCurveEndTangent(points: number[], tension: number): CurveDirection {
  if (points.length !== 6) {
    throw new Error("A curva direcional deve conter exatamente tres pontos.");
  }

  const [startX, startY, middleX, middleY, endX, endY] = points;
  const firstLength = Math.hypot(middleX - startX, middleY - startY);
  const secondLength = Math.hypot(endX - middleX, endY - middleY);
  const totalLength = firstLength + secondLength;

  // Com um trecho degenerado, a direcao inicio -> fim ainda oferece um fallback
  // estavel para a ponta, sem produzir NaN na renderizacao.
  if (totalLength === 0) {
    return { x: 1, y: 0 };
  }

  const outgoingFactor = (tension * secondLength) / totalLength;
  const controlX = middleX + outgoingFactor * (endX - startX);
  const controlY = middleY + outgoingFactor * (endY - startY);
  let tangentX = endX - controlX;
  let tangentY = endY - controlY;
  let tangentLength = Math.hypot(tangentX, tangentY);

  if (tangentLength === 0) {
    tangentX = endX - startX;
    tangentY = endY - startY;
    tangentLength = Math.hypot(tangentX, tangentY);
  }

  if (tangentLength === 0) {
    return { x: 1, y: 0 };
  }

  return { x: tangentX / tangentLength, y: tangentY / tangentLength };
}
