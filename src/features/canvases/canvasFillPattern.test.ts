import { afterEach, describe, expect, it, vi } from "vitest";

import { getFillPatternImage } from "./canvasFillPattern";

function mockCanvasDocument() {
  const context = {
    strokeStyle: "",
    lineWidth: 0,
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  const createElement = vi.fn(() => ({
    width: 0,
    height: 0,
    getContext: () => context,
  }) as unknown as HTMLCanvasElement);
  vi.stubGlobal("document", { createElement });
  return createElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getFillPatternImage", () => {
  it("reutiliza a mesma instancia para estilo e cor iguais", () => {
    const createElement = mockCanvasDocument();

    const first = getFillPatternImage("hachure", "#111111");
    const second = getFillPatternImage("hachure", "#111111");

    expect(second).toBe(first);
    expect(createElement).toHaveBeenCalledTimes(1);
  });

  it("cria instancias diferentes para cores diferentes", () => {
    const createElement = mockCanvasDocument();

    const first = getFillPatternImage("cross-hatch", "#222222");
    const second = getFillPatternImage("cross-hatch", "#333333");

    expect(second).not.toBe(first);
    expect(createElement).toHaveBeenCalledTimes(2);
  });
});
