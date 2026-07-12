import { describe, expect, it } from "vitest";

import { areCanvasShapesEqual, canvasHistoryLimit, createCanvasHistory } from "./canvasHistory";
import type { CanvasShape } from "./canvasScene";

function scene(value: number): CanvasShape[] {
  return [
    {
      id: "shape-1",
      type: "line",
      x: value,
      y: 0,
      width: value,
      height: 0,
      points: [0, 0, value, 0],
      rotation: 0,
      stroke: "#2C1A10",
      strokeWidth: 2,
      fill: null,
      fillStyle: "none",
      text: "",
      fontSize: 16,
      fileId: null,
    },
  ];
}

describe("createCanvasHistory", () => {
  it("restaura snapshots na ordem correta ao alternar undo e redo", () => {
    const history = createCanvasHistory();
    const state0 = scene(0);
    const state1 = scene(10);
    const state2 = scene(20);

    history.pushSnapshot(state0);
    history.pushSnapshot(state1);

    expect(history.undo(state2)).toEqual(state1);
    expect(history.undo(state1)).toEqual(state0);
    expect(history.redo(state0)).toEqual(state1);
    expect(history.redo(state1)).toEqual(state2);
    expect(history.redo(state2)).toBeNull();
  });

  it("mantem somente os cinquenta snapshots mais recentes", () => {
    const history = createCanvasHistory();
    for (let value = 0; value <= canvasHistoryLimit; value += 1) {
      history.pushSnapshot(scene(value));
    }

    let current = scene(canvasHistoryLimit + 1);
    for (let value = canvasHistoryLimit; value >= 1; value -= 1) {
      const restored = history.undo(current);
      expect(restored).toEqual(scene(value));
      current = restored ?? current;
    }

    expect(history.undo(current)).toBeNull();
  });

  it("limpa o redo quando uma nova acao e confirmada apos undo", () => {
    const history = createCanvasHistory();
    const state0 = scene(0);
    const state1 = scene(10);
    const state2 = scene(20);

    history.pushSnapshot(state0);
    expect(history.undo(state1)).toEqual(state0);

    history.pushSnapshot(state0);
    expect(history.redo(state2)).toBeNull();
  });

  it("isola points do snapshot contra mutacoes posteriores", () => {
    const history = createCanvasHistory();
    const state0 = scene(0);
    history.pushSnapshot(state0);
    state0[0].points[2] = 999;

    expect(history.undo(scene(10))).toEqual(scene(0));
  });

  it("distingue uma mutacao real de uma confirmacao sem alteracao", () => {
    const original = scene(10);
    const sameValues = scene(10);
    const changedPoint = scene(10);
    changedPoint[0].points[2] = 11;

    expect(areCanvasShapesEqual(original, sameValues)).toBe(true);
    expect(areCanvasShapesEqual(original, changedPoint)).toBe(false);
  });
});
