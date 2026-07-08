import { describe, expect, it } from "vitest";

import {
  clampFigureDimension,
  computeImageResize,
  figureDimensionsFromScale,
  figureMaxDimensionPx,
  figureMinDimensionPx,
  isFigureDimensionAttribute,
  isImageCornerHandle,
  parseFigureDimension,
  parseFigureDimensions,
  resolveFigureExportSizing,
  serializeFigureDimension,
} from "./notebookFigureDimensions";

describe("parseFigureDimension", () => {
  it("aceita inteiros dentro do intervalo", () => {
    expect(parseFigureDimension("48")).toBe(48);
    expect(parseFigureDimension("320")).toBe(320);
    expect(parseFigureDimension(" 500 ")).toBe(500);
    expect(parseFigureDimension(String(figureMaxDimensionPx))).toBe(figureMaxDimensionPx);
  });

  it("trata ausencia como sem dimensao", () => {
    expect(parseFigureDimension(null)).toBeNull();
    expect(parseFigureDimension(undefined)).toBeNull();
    expect(parseFigureDimension("")).toBeNull();
    expect(parseFigureDimension("   ")).toBeNull();
  });

  it("rejeita valores nao numericos, fracionarios e infinitos", () => {
    expect(parseFigureDimension("abc")).toBeNull();
    expect(parseFigureDimension("320px")).toBeNull();
    expect(parseFigureDimension("32.5")).toBeNull();
    expect(parseFigureDimension("Infinity")).toBeNull();
    expect(parseFigureDimension("1e3")).toBeNull();
  });

  it("rejeita valores abaixo do minimo e acima do maximo", () => {
    expect(parseFigureDimension(String(figureMinDimensionPx - 1))).toBeNull();
    expect(parseFigureDimension("0")).toBeNull();
    expect(parseFigureDimension("-100")).toBeNull();
    expect(parseFigureDimension(String(figureMaxDimensionPx + 1))).toBeNull();
  });
});

describe("clampFigureDimension", () => {
  it("clampa e arredonda para o intervalo valido", () => {
    expect(clampFigureDimension(10)).toBe(figureMinDimensionPx);
    expect(clampFigureDimension(999999)).toBe(figureMaxDimensionPx);
    expect(clampFigureDimension(120.4)).toBe(120);
    expect(clampFigureDimension(120.6)).toBe(121);
  });

  it("cai no minimo para valores nao finitos", () => {
    expect(clampFigureDimension(Number.NaN)).toBe(figureMinDimensionPx);
    expect(clampFigureDimension(Number.POSITIVE_INFINITY)).toBe(figureMinDimensionPx);
  });
});

describe("parseFigureDimensions", () => {
  it("exige as duas dimensoes validas juntas", () => {
    expect(parseFigureDimensions("400", "300")).toEqual({ width: 400, height: 300 });
    expect(parseFigureDimensions("400", null)).toBeNull();
    expect(parseFigureDimensions(null, "300")).toBeNull();
    expect(parseFigureDimensions("400", "0")).toBeNull();
    expect(parseFigureDimensions("abc", "300")).toBeNull();
  });
});

describe("serializeFigureDimension / isFigureDimensionAttribute", () => {
  it("serializa como inteiro clampado", () => {
    expect(serializeFigureDimension(320.6)).toBe("321");
    expect(serializeFigureDimension(5)).toBe(String(figureMinDimensionPx));
  });

  it("reconhece apenas os atributos de dimensao dedicados", () => {
    expect(isFigureDimensionAttribute("data-figure-width")).toBe(true);
    expect(isFigureDimensionAttribute("data-figure-height")).toBe(true);
    expect(isFigureDimensionAttribute("data-figure-scale")).toBe(false);
    expect(isFigureDimensionAttribute("style")).toBe(false);
  });
});

describe("figureDimensionsFromScale", () => {
  it("converte escala legada em largura/altura proporcionais", () => {
    expect(figureDimensionsFromScale(50, 400, 300)).toEqual({ width: 200, height: 150 });
    expect(figureDimensionsFromScale(100, 400, 300)).toEqual({ width: 400, height: 300 });
  });

  it("retorna null quando o tamanho natural e desconhecido", () => {
    expect(figureDimensionsFromScale(80, 0, 0)).toBeNull();
    expect(figureDimensionsFromScale(Number.NaN, 400, 300)).toBeNull();
  });
});

describe("resolveFigureExportSizing", () => {
  it("figura antiga sem dimensoes fica no tamanho natural", () => {
    expect(resolveFigureExportSizing(null, null, null)).toEqual({ kind: "natural" });
  });

  it("figura antiga com data-figure-scale continua proporcional", () => {
    expect(resolveFigureExportSizing(null, null, "72")).toEqual({ kind: "scale", percent: 72 });
    // escala 100 (default) nao gera estilo
    expect(resolveFigureExportSizing(null, null, "100")).toEqual({ kind: "natural" });
  });

  it("figura nova com largura e altura usa as dimensoes independentes", () => {
    expect(resolveFigureExportSizing("480", "270", null)).toEqual({ kind: "dimensions", width: 480, height: 270 });
  });

  it("dimensoes tem prioridade sobre a escala legada", () => {
    expect(resolveFigureExportSizing("480", "270", "72")).toEqual({ kind: "dimensions", width: 480, height: 270 });
  });

  it("valores invalidos, fora dos limites ou infinitos caem no natural", () => {
    expect(resolveFigureExportSizing("0", "270", null)).toEqual({ kind: "natural" });
    expect(resolveFigureExportSizing(String(figureMaxDimensionPx + 1), "270", null)).toEqual({ kind: "natural" });
    expect(resolveFigureExportSizing("abc", "def", null)).toEqual({ kind: "natural" });
    expect(resolveFigureExportSizing("Infinity", "Infinity", null)).toEqual({ kind: "natural" });
  });
});

describe("computeImageResize", () => {
  const start = { startWidth: 400, startHeight: 300, preserveAspect: false as const };

  it("handles laterais alteram somente a largura", () => {
    expect(computeImageResize({ ...start, handle: "e", deltaX: 50, deltaY: 80 })).toEqual({ width: 450, height: 300 });
    expect(computeImageResize({ ...start, handle: "w", deltaX: 60, deltaY: 80 })).toEqual({ width: 340, height: 300 });
  });

  it("handles superior e inferior alteram somente a altura", () => {
    expect(computeImageResize({ ...start, handle: "s", deltaX: 90, deltaY: 40 })).toEqual({ width: 400, height: 340 });
    expect(computeImageResize({ ...start, handle: "n", deltaX: 90, deltaY: 50 })).toEqual({ width: 400, height: 250 });
  });

  it("cantos alteram largura e altura de forma independente (aspecto livre)", () => {
    expect(computeImageResize({ ...start, handle: "se", deltaX: 100, deltaY: 30 })).toEqual({ width: 500, height: 330 });
    expect(computeImageResize({ ...start, handle: "nw", deltaX: 40, deltaY: 60 })).toEqual({ width: 360, height: 240 });
  });

  it("com preserveAspect nos cantos mantem a proporcao inicial", () => {
    const result = computeImageResize({ ...start, preserveAspect: true, handle: "se", deltaX: 200, deltaY: 3 });
    // dominado pela largura (400 -> 600); altura acompanha 4:3 -> 450
    expect(result).toEqual({ width: 600, height: 450 });
  });

  it("respeita o limite minimo", () => {
    const result = computeImageResize({ ...start, handle: "w", deltaX: 100000, deltaY: 0 });
    expect(result.width).toBe(figureMinDimensionPx);
  });

  it("respeita o limite maximo", () => {
    const result = computeImageResize({ ...start, handle: "e", deltaX: 100000, deltaY: 0 });
    expect(result.width).toBe(figureMaxDimensionPx);
  });

  it("aplica o teto de largura util e, com aspecto travado, reduz a altura junto", () => {
    const free = computeImageResize({ ...start, handle: "e", deltaX: 1000, deltaY: 0, maxWidth: 500 });
    expect(free).toEqual({ width: 500, height: 300 });

    const locked = computeImageResize({
      ...start,
      preserveAspect: true,
      handle: "se",
      deltaX: 1000,
      deltaY: 0,
      maxWidth: 600,
    });
    // largura travada em 600 e altura proporcional 4:3 -> 450
    expect(locked).toEqual({ width: 600, height: 450 });
  });

  it("classifica cantos e laterais", () => {
    expect(isImageCornerHandle("se")).toBe(true);
    expect(isImageCornerHandle("nw")).toBe(true);
    expect(isImageCornerHandle("e")).toBe(false);
    expect(isImageCornerHandle("n")).toBe(false);
  });
});
