export type CanvasPoint = { x: number; y: number };

export type DirectionalGeometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  points: number[];
};

export type DirectionalEndpoint = "start" | "end";

export const minimumDirectionalLength = 4;

export function getDirectionalEndpoints(geometry: Pick<DirectionalGeometry, "x" | "y" | "points">): {
  start: CanvasPoint;
  end: CanvasPoint;
} {
  const endX = geometry.points[2] ?? 0;
  const endY = geometry.points[3] ?? 0;
  return {
    start: { x: geometry.x, y: geometry.y },
    end: { x: geometry.x + endX, y: geometry.y + endY },
  };
}

function keepMinimumDistance(candidate: CanvasPoint, fixed: CanvasPoint, previous: CanvasPoint): CanvasPoint {
  const candidateDeltaX = candidate.x - fixed.x;
  const candidateDeltaY = candidate.y - fixed.y;
  const candidateDistance = Math.hypot(candidateDeltaX, candidateDeltaY);
  if (candidateDistance >= minimumDirectionalLength) {
    return candidate;
  }

  const previousDeltaX = previous.x - fixed.x;
  const previousDeltaY = previous.y - fixed.y;
  const previousDistance = Math.hypot(previousDeltaX, previousDeltaY);
  const directionX = previousDistance > 0 ? previousDeltaX / previousDistance : 1;
  const directionY = previousDistance > 0 ? previousDeltaY / previousDistance : 0;
  return {
    x: fixed.x + directionX * minimumDirectionalLength,
    y: fixed.y + directionY * minimumDirectionalLength,
  };
}

// Atualiza uma ponta mantendo a outra fixa no espaço do Quadro. A cena persiste
// a primeira ponta como âncora e a segunda como vetor relativo a ela.
export function moveDirectionalEndpoint(
  geometry: DirectionalGeometry,
  endpoint: DirectionalEndpoint,
  candidate: CanvasPoint,
): DirectionalGeometry {
  const { start, end } = getDirectionalEndpoints(geometry);
  const nextStart = endpoint === "start" ? keepMinimumDistance(candidate, end, start) : start;
  const nextEnd = endpoint === "end" ? keepMinimumDistance(candidate, start, end) : end;
  const deltaX = nextEnd.x - nextStart.x;
  const deltaY = nextEnd.y - nextStart.y;

  return {
    x: nextStart.x,
    y: nextStart.y,
    width: Math.abs(deltaX),
    height: Math.abs(deltaY),
    points: [0, 0, deltaX, deltaY],
  };
}
