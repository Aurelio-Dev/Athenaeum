import { describe, expect, it } from "vitest";
import { detectVisibleContentBounds } from "./pdfVisibleContent";

function createPixels(width: number, height: number) {
  return new Uint8ClampedArray(width * height * 4);
}

function paintRect(
  data: Uint8ClampedArray,
  width: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
  rgba: readonly [number, number, number, number],
) {
  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * width + x) * 4;
      data.set(rgba, index);
    }
  }
}

describe("detectVisibleContentBounds", () => {
  it("encontra conteudo vetorial sobre fundo transparente", () => {
    const width = 100;
    const height = 120;
    const data = createPixels(width, height);
    paintRect(data, width, 20, 30, 80, 90, [20, 20, 20, 255]);

    const bounds = detectVisibleContentBounds(data, width, height);
    expect(bounds.confidence).toBe("high");
    expect(bounds.left).toBeLessThanOrEqual(0.2);
    expect(bounds.right).toBeGreaterThanOrEqual(0.8);
    expect(bounds.top).toBeLessThanOrEqual(0.25);
    expect(bounds.bottom).toBeGreaterThanOrEqual(0.75);
  });

  it("remove margem uniforme de uma pagina opaca", () => {
    const width = 100;
    const height = 100;
    const data = createPixels(width, height);
    paintRect(data, width, 0, 0, width, height, [247, 246, 243, 255]);
    paintRect(data, width, 18, 22, 82, 78, [30, 30, 30, 255]);

    const bounds = detectVisibleContentBounds(data, width, height);
    expect(bounds.confidence).toBe("medium");
    expect(bounds.left).toBeGreaterThan(0);
    expect(bounds.right).toBeLessThan(1);
  });

  it("mantem a pagina inteira quando ela esta vazia", () => {
    expect(detectVisibleContentBounds(createPixels(20, 20), 20, 20)).toMatchObject({
      left: 0,
      top: 0,
      right: 1,
      bottom: 1,
      confidence: "low",
    });
  });

  it("ignora um pixel isolado", () => {
    const data = createPixels(30, 30);
    data.set([0, 0, 0, 255], (15 * 30 + 15) * 4);
    expect(detectVisibleContentBounds(data, 30, 30).confidence).toBe("low");
  });
});
