import { describe, expect, it } from "vitest";

import { getDirectionalEndpoints, minimumDirectionalLength, moveDirectionalEndpoint } from "./canvasDirectionalHandles";

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
});
