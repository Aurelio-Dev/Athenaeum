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
  const endX = geometry.points[geometry.points.length - 2] ?? 0;
  const endY = geometry.points[geometry.points.length - 1] ?? 0;
  return {
    start: { x: geometry.x, y: geometry.y },
    end: { x: geometry.x + endX, y: geometry.y + endY },
  };
}

export function getDirectionalControlPoint(geometry: Pick<DirectionalGeometry, "x" | "y" | "points">): CanvasPoint {
  const { start, end } = getDirectionalEndpoints(geometry);
  if (geometry.points.length === 6) {
    return { x: geometry.x + geometry.points[2], y: geometry.y + geometry.points[3] };
  }
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function getDirectionalSize(points: number[]): Pick<DirectionalGeometry, "width" | "height"> {
  let minX = points[0] ?? 0;
  let maxX = minX;
  let minY = points[1] ?? 0;
  let maxY = minY;

  for (let index = 2; index + 1 < points.length; index += 2) {
    minX = Math.min(minX, points[index]);
    maxX = Math.max(maxX, points[index]);
    minY = Math.min(minY, points[index + 1]);
    maxY = Math.max(maxY, points[index + 1]);
  }

  return { width: maxX - minX, height: maxY - minY };
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
  const points =
    geometry.points.length === 6
      ? [
          0,
          0,
          geometry.x + geometry.points[2] - nextStart.x,
          geometry.y + geometry.points[3] - nextStart.y,
          deltaX,
          deltaY,
        ]
      : [0, 0, deltaX, deltaY];

  return {
    x: nextStart.x,
    y: nextStart.y,
    ...getDirectionalSize(points),
    points,
  };
}

export function moveDirectionalControlPoint(
  geometry: DirectionalGeometry,
  candidate: CanvasPoint,
): DirectionalGeometry {
  const { start, end } = getDirectionalEndpoints(geometry);
  const points = [
    0,
    0,
    candidate.x - start.x,
    candidate.y - start.y,
    end.x - start.x,
    end.y - start.y,
  ];

  return {
    x: start.x,
    y: start.y,
    ...getDirectionalSize(points),
    points,
  };
}
