import { describe, expect, it } from "vitest";
import { Line as KonvaLine } from "konva/lib/shapes/Line.js";

import {
  canvasDirectionalCurveTension,
  getCurveEndTangent,
  getDirectionalTension,
} from "./canvasArrowCurve";

describe("getCurveEndTangent", () => {
  it("mantem a direcao inicio-fim para tres pontos colineares", () => {
    const tangent = getCurveEndTangent([0, 0, 40, 20, 100, 50], canvasDirectionalCurveTension);

    expect(tangent.x).toBeCloseTo(2 / Math.sqrt(5), 12);
    expect(tangent.y).toBeCloseTo(1 / Math.sqrt(5), 12);
  });

  it("calcula a tangente final de uma curva assimetrica pela formula do Konva", () => {
    const points = [0, 0, 30, 90, 140, 20];
    const tangent = getCurveEndTangent(points, 0.5);
    const konvaTensionPoints = new KonvaLine({ points, tension: 0.5 }).getTensionPoints() as number[];
    const konvaEndDeltaX = points[4] - konvaTensionPoints[4];
    const konvaEndDeltaY = points[5] - konvaTensionPoints[5];
    const konvaEndLength = Math.hypot(konvaEndDeltaX, konvaEndDeltaY);

    // getControlPoints() do Konva resulta em C2 ~= (70.518, 95.788).
    // A derivada da ultima quadratica no fim e 2 * (P2 - C2).
    expect(tangent.x).toBeCloseTo(0.6757714785, 10);
    expect(tangent.y).toBeCloseTo(-0.7371111916, 10);
    expect(tangent.x).toBeCloseTo(konvaEndDeltaX / konvaEndLength, 12);
    expect(tangent.y).toBeCloseTo(konvaEndDeltaY / konvaEndLength, 12);
    expect(Math.hypot(tangent.x, tangent.y)).toBeCloseTo(1, 12);
  });
});

describe("getDirectionalTension", () => {
  it("renderiza somente direcionais com seis numeros como curva", () => {
    expect(getDirectionalTension([0, 0, 20, 10])).toBe(0);
    expect(getDirectionalTension([0, 0, 10, 20, 30, 0])).toBe(canvasDirectionalCurveTension);
  });
});
