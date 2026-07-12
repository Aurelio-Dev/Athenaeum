import type { CanvasShape } from "./canvasScene";

export const canvasHistoryLimit = 50;

function cloneShapes(shapes: CanvasShape[]): CanvasShape[] {
  return shapes.map((shape) => ({ ...shape, points: [...shape.points] }));
}

export function areCanvasShapesEqual(left: CanvasShape[], right: CanvasShape[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((shape, index) => {
    const other = right[index];
    if (
      shape.id !== other.id ||
      shape.type !== other.type ||
      shape.x !== other.x ||
      shape.y !== other.y ||
      shape.width !== other.width ||
      shape.height !== other.height ||
      shape.rotation !== other.rotation ||
      shape.stroke !== other.stroke ||
      shape.strokeWidth !== other.strokeWidth ||
      shape.fill !== other.fill ||
      shape.fillStyle !== other.fillStyle ||
      shape.text !== other.text ||
      shape.fontSize !== other.fontSize ||
      shape.fileId !== other.fileId ||
      shape.points.length !== other.points.length
    ) {
      return false;
    }

    return shape.points.every((point, pointIndex) => point === other.points[pointIndex]);
  });
}

export type CanvasHistory = {
  pushSnapshot: (shapes: CanvasShape[]) => void;
  undo: (currentShapes: CanvasShape[]) => CanvasShape[] | null;
  redo: (currentShapes: CanvasShape[]) => CanvasShape[] | null;
};

// Historico em memoria do painel. Os snapshots sao completos e isolados para
// que uma mutacao posterior de points nunca altere um estado anterior.
export function createCanvasHistory(): CanvasHistory {
  let undoStack: CanvasShape[][] = [];
  let redoStack: CanvasShape[][] = [];

  return {
    pushSnapshot(shapes) {
      undoStack.push(cloneShapes(shapes));
      if (undoStack.length > canvasHistoryLimit) {
        undoStack.shift();
      }
      redoStack = [];
    },
    undo(currentShapes) {
      const snapshot = undoStack.pop();
      if (!snapshot) {
        return null;
      }

      redoStack.push(cloneShapes(currentShapes));
      return cloneShapes(snapshot);
    },
    redo(currentShapes) {
      const snapshot = redoStack.pop();
      if (!snapshot) {
        return null;
      }

      undoStack.push(cloneShapes(currentShapes));
      if (undoStack.length > canvasHistoryLimit) {
        undoStack.shift();
      }
      return cloneShapes(snapshot);
    },
  };
}
