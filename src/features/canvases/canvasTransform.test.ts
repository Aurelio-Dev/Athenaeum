import { describe, expect, it } from "vitest";

import { finalizeCanvasTransform, lockSideAnchorAspectRatio } from "./canvasTransform";

describe("finalizeCanvasTransform", () => {
  it("converte escala em dimensoes reais e preserva rotacao", () => {
    expect(
      finalizeCanvasTransform({ x: 10, y: 20, width: 100, height: 50, scaleX: 1.5, scaleY: 0.5, rotation: 30 }),
    ).toEqual({ x: 10, y: 20, width: 150, height: 25, rotation: 30 });
  });

  it("normaliza flip nos dois eixos sem mudar a caixa visual", () => {
    expect(
      finalizeCanvasTransform({ x: 100, y: 80, width: 40, height: 20, scaleX: -2, scaleY: -3, rotation: 0 }),
    ).toEqual({ x: 20, y: 20, width: 80, height: 60, rotation: 0 });
  });

  it("ajusta a origem do flip seguindo os eixos rotacionados", () => {
    const result = finalizeCanvasTransform({
      x: 50,
      y: 70,
      width: 40,
      height: 20,
      scaleX: -2,
      scaleY: 1,
      rotation: 90,
    });

    expect(result.x).toBeCloseTo(50);
    expect(result.y).toBeCloseTo(-10);
    expect(result).toMatchObject({ width: 80, height: 20, rotation: 90 });
  });

  it("aplica o limite minimo apenas ao resultado persistido", () => {
    expect(
      finalizeCanvasTransform({ x: 0, y: 0, width: 20, height: 10, scaleX: 0.1, scaleY: -0.2, rotation: 0 }),
    ).toEqual({ x: 0, y: -2, width: 4, height: 4, rotation: 0 });
  });
});

describe("lockSideAnchorAspectRatio", () => {
  it("preserva proporcao no handle lateral sem perder o centro", () => {
    expect(
      lockSideAnchorAspectRatio({ x: 10, y: 20, width: 200, height: 50, rotation: 0 }, "middle-right", 2),
    ).toEqual({ x: 10, y: -5, width: 200, height: 100, rotation: 0 });
  });

  it("preserva proporcao no handle vertical e mantem o flip", () => {
    expect(
      lockSideAnchorAspectRatio({ x: 20, y: 30, width: -60, height: 80, rotation: 0 }, "bottom-center", 2),
    ).toEqual({ x: 70, y: 30, width: -160, height: 80, rotation: 0 });
  });
});
