import { describe, expect, it } from "vitest";

import {
  getDirectionalControlPoint,
  getDirectionalEndpoints,
  minimumDirectionalLength,
  moveDirectionalControlPoint,
  moveDirectionalEndpoint,
} from "./canvasDirectionalHandles";

const initialGeometry = { x: 10, y: 20, width: 30, height: 40, points: [0, 0, 30, 40] };

describe("moveDirectionalEndpoint", () => {
  it("move o ponto inicial e preserva visualmente o ponto final", () => {
    const result = moveDirectionalEndpoint(initialGeometry, "start", { x: 5, y: 6 });

    expect(result).toEqual({ x: 5, y: 6, width: 35, height: 54, points: [0, 0, 35, 54] });
    expect(getDirectionalEndpoints(result).end).toEqual({ x: 40, y: 60 });
  });

  it("move o ponto final e preserva a ancora inicial", () => {
    const result = moveDirectionalEndpoint(initialGeometry, "end", { x: 70, y: 25 });

    expect(result).toEqual({ x: 10, y: 20, width: 60, height: 5, points: [0, 0, 60, 5] });
    expect(getDirectionalEndpoints(result).start).toEqual({ x: 10, y: 20 });
  });

  it("impede que o ponto inicial colapse sobre o final", () => {
    const result = moveDirectionalEndpoint(initialGeometry, "start", { x: 40, y: 60 });
    const { start, end } = getDirectionalEndpoints(result);

    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(minimumDirectionalLength);
    expect(end).toEqual({ x: 40, y: 60 });
  });

  it("impede que o ponto final colapse sobre o inicio", () => {
    const result = moveDirectionalEndpoint(initialGeometry, "end", { x: 10, y: 20 });
    const { start, end } = getDirectionalEndpoints(result);

    expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeCloseTo(minimumDirectionalLength);
    expect(start).toEqual({ x: 10, y: 20 });
  });

  it("move o inicio de uma curva preservando controle e fim absolutos", () => {
    const curve = { x: 10, y: 20, width: 50, height: 45, points: [0, 0, 20, -5, 50, 40] };

    const result = moveDirectionalEndpoint(curve, "start", { x: 5, y: 10 });

    expect(result).toEqual({ x: 5, y: 10, width: 55, height: 50, points: [0, 0, 25, 5, 55, 50] });
    expect(getDirectionalControlPoint(result)).toEqual({ x: 30, y: 15 });
    expect(getDirectionalEndpoints(result).end).toEqual({ x: 60, y: 60 });
  });

  it("move o fim de uma curva sem alterar o controle absoluto", () => {
    const curve = { x: 10, y: 20, width: 50, height: 45, points: [0, 0, 20, -5, 50, 40] };

    const result = moveDirectionalEndpoint(curve, "end", { x: 80, y: 30 });

    expect(result).toEqual({ x: 10, y: 20, width: 70, height: 15, points: [0, 0, 20, -5, 70, 10] });
    expect(getDirectionalControlPoint(result)).toEqual({ x: 30, y: 15 });
  });
});

describe("moveDirectionalControlPoint", () => {
  it("converte uma reta em curva usando o ponto medio arrastado", () => {
    expect(getDirectionalControlPoint(initialGeometry)).toEqual({ x: 25, y: 40 });

    const result = moveDirectionalControlPoint(initialGeometry, { x: 50, y: 5 });

    expect(result).toEqual({ x: 10, y: 20, width: 40, height: 55, points: [0, 0, 40, -15, 30, 40] });
    expect(getDirectionalControlPoint(result)).toEqual({ x: 50, y: 5 });
  });

  it("atualiza o controle de uma curva sem alterar as pontas", () => {
    const curve = { x: 10, y: 20, width: 30, height: 40, points: [0, 0, 15, 10, 30, 40] };

    const result = moveDirectionalControlPoint(curve, { x: 5, y: 80 });

    expect(result).toEqual({ x: 10, y: 20, width: 35, height: 60, points: [0, 0, -5, 60, 30, 40] });
    expect(getDirectionalEndpoints(result)).toEqual({ start: { x: 10, y: 20 }, end: { x: 40, y: 60 } });
  });
});
