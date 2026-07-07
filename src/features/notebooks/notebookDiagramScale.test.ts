import { describe, expect, it } from "vitest";

import {
  clampDiagramScale,
  parseDiagramScale,
  parseLegacyDiagramWidthPercent,
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
