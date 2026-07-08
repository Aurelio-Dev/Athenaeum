import { describe, expect, it } from "vitest";

import {
  clampDiagramScale,
  clampResizableScale,
  getExportScaleWidthPercent,
  getResolvedResizableScale,
  getResizableScaleDatasetKey,
  isResizableScaleAttribute,
  parseEquationScale,
  parseDiagramScale,
  parseFigureScale,
  parseLegacyDiagramWidthPercent,
  parseResizableScale,
  serializeResizableScale,
  stepDiagramScale,
} from "./notebookDiagramScale";

describe("parseDiagramScale", () => {
  it("treats absence as natural size", () => {
    expect(parseDiagramScale(null)).toBeNull();
    expect(parseDiagramScale(undefined)).toBeNull();
    expect(parseDiagramScale("")).toBeNull();
    expect(parseDiagramScale("   ")).toBeNull();
  });

  it("accepts integers inside the allowed range", () => {
    expect(parseDiagramScale("100")).toBe(100);
    expect(parseDiagramScale("50")).toBe(50);
    expect(parseDiagramScale("160")).toBe(160);
    expect(parseDiagramScale(" 72 ")).toBe(72);
  });

  it("rejects invalid text", () => {
    expect(parseDiagramScale("abc")).toBeNull();
    expect(parseDiagramScale("100%")).toBeNull();
    expect(parseDiagramScale("1 00")).toBeNull();
  });

  it("rejects fractional values", () => {
    expect(parseDiagramScale("72.5")).toBeNull();
    expect(parseDiagramScale("99,9")).toBeNull();
  });

  it("rejects values below the minimum", () => {
    expect(parseDiagramScale("49")).toBeNull();
    expect(parseDiagramScale("0")).toBeNull();
    expect(parseDiagramScale("-80")).toBeNull();
  });

  it("rejects values above the maximum", () => {
    expect(parseDiagramScale("161")).toBeNull();
    expect(parseDiagramScale("400")).toBeNull();
  });
});

describe("clampDiagramScale", () => {
  it("clamps into the allowed range and rounds", () => {
    expect(clampDiagramScale(72.4)).toBe(72);
    expect(clampDiagramScale(72.6)).toBe(73);
    expect(clampDiagramScale(10)).toBe(50);
    expect(clampDiagramScale(400)).toBe(160);
  });

  it("falls back to 100 for non-finite values", () => {
    expect(clampDiagramScale(Number.NaN)).toBe(100);
    expect(clampDiagramScale(Number.POSITIVE_INFINITY)).toBe(100);
  });
});

describe("shared resizable scale helpers", () => {
  it("uses the same parser for every resizable block kind", () => {
    expect(parseResizableScale(null)).toBeNull();
    expect(parseDiagramScale("125")).toBe(125);
    expect(parseEquationScale("125")).toBe(125);
    expect(parseFigureScale("125")).toBe(125);
  });

  it("returns the default for missing scale values", () => {
    expect(getResolvedResizableScale(undefined)).toBe(100);
    expect(getResolvedResizableScale("")).toBe(100);
  });

  it("clamps values below and above the allowed range", () => {
    expect(clampResizableScale(12)).toBe(50);
    expect(clampResizableScale(260)).toBe(160);
  });

  it("rejects NaN, Infinity, text and empty strings", () => {
    expect(serializeResizableScale(Number.NaN)).toBeNull();
    expect(serializeResizableScale(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseResizableScale("texto")).toBeNull();
    expect(parseResizableScale("")).toBeNull();
  });

  it("serializes precision stably as integer percentages", () => {
    expect(serializeResizableScale(72.49)).toBe("72");
    expect(serializeResizableScale(72.5)).toBe("73");
    expect(serializeResizableScale(100)).toBeNull();
  });

  it("serializes new equation and figure scales with the same stable numeric contract", () => {
    expect(serializeResizableScale(parseEquationScale("88"))).toBe("88");
    expect(serializeResizableScale(parseFigureScale("160"))).toBe("160");
    expect(parseEquationScale("49")).toBeNull();
    expect(parseFigureScale("161")).toBeNull();
  });

  it("exposes only the allowed persisted scale attributes", () => {
    expect(isResizableScaleAttribute("data-diagram-scale")).toBe(true);
    expect(isResizableScaleAttribute("data-equation-scale")).toBe(true);
    expect(isResizableScaleAttribute("data-figure-scale")).toBe(true);
    expect(isResizableScaleAttribute("style")).toBe(false);
    expect(isResizableScaleAttribute("data-random-scale")).toBe(false);
  });

  it("maps scale attributes to their dataset keys", () => {
    expect(getResizableScaleDatasetKey("data-diagram-scale")).toBe("diagramScale");
    expect(getResizableScaleDatasetKey("data-equation-scale")).toBe("equationScale");
    expect(getResizableScaleDatasetKey("data-figure-scale")).toBe("figureScale");
    expect(getResizableScaleDatasetKey("data-random-scale")).toBeNull();
  });

  it("uses the sanitized scale as controlled export width", () => {
    expect(getExportScaleWidthPercent(null)).toBeNull();
    expect(getExportScaleWidthPercent("72")).toBe(72);
    expect(getExportScaleWidthPercent("49")).toBeNull();
    expect(getExportScaleWidthPercent("100")).toBeNull();
    expect(getExportScaleWidthPercent("161")).toBeNull();
    expect(getExportScaleWidthPercent("texto")).toBeNull();
  });
});

describe("stepDiagramScale", () => {
  it("steps by 5% and clamps at the boundaries", () => {
    expect(stepDiagramScale(100, 1, false)).toBe(105);
    expect(stepDiagramScale(100, -1, false)).toBe(95);
    expect(stepDiagramScale(158, 1, false)).toBe(160);
    expect(stepDiagramScale(52, -1, false)).toBe(50);
    expect(stepDiagramScale(160, 1, false)).toBe(160);
    expect(stepDiagramScale(50, -1, false)).toBe(50);
  });

  it("steps by 10% with the large step", () => {
    expect(stepDiagramScale(100, 1, true)).toBe(110);
    expect(stepDiagramScale(100, -1, true)).toBe(90);
    expect(stepDiagramScale(155, 1, true)).toBe(160);
    expect(stepDiagramScale(55, -1, true)).toBe(50);
  });

  it("supports resetting to 100 via clamp of the default", () => {
    expect(clampDiagramScale(100)).toBe(100);
  });
});

describe("parseLegacyDiagramWidthPercent", () => {
  it("reads the legacy attribute range (40..100)", () => {
    expect(parseLegacyDiagramWidthPercent("72")).toBe(72);
    expect(parseLegacyDiagramWidthPercent("40")).toBe(40);
    expect(parseLegacyDiagramWidthPercent("100")).toBe(100);
  });

  it("rejects invalid or out-of-range legacy values", () => {
    expect(parseLegacyDiagramWidthPercent(null)).toBeNull();
    expect(parseLegacyDiagramWidthPercent("39")).toBeNull();
    expect(parseLegacyDiagramWidthPercent("101")).toBeNull();
    expect(parseLegacyDiagramWidthPercent("72.5")).toBeNull();
    expect(parseLegacyDiagramWidthPercent("abc")).toBeNull();
  });

  it("maps legacy widths into the scale range via clamp", () => {
    // 40% de largura vira 50% de escala (piso do novo intervalo).
    expect(clampDiagramScale(40)).toBe(50);
    expect(clampDiagramScale(72)).toBe(72);
    expect(clampDiagramScale(100)).toBe(100);
  });
});
