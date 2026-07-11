import { describe, expect, it } from "vitest";

import type { CanvasShapeType } from "./canvasScene";
import { getCanvasPropertiesSections } from "./canvasPropertiesSections";

describe("getCanvasPropertiesSections", () => {
  it.each<CanvasShapeType>(["rect", "diamond", "ellipse"])(
    "exibe cor, traco e preenchimento para %s",
    (type) => {
      expect(getCanvasPropertiesSections(type)).toEqual({ cor: true, traco: true, preenchimento: true });
    },
  );

  it.each<CanvasShapeType>(["arrow", "line", "freedraw"])("exibe somente cor e traco para %s", (type) => {
    expect(getCanvasPropertiesSections(type)).toEqual({ cor: true, traco: true, preenchimento: false });
  });

  it("exibe somente cor para texto", () => {
    expect(getCanvasPropertiesSections("text")).toEqual({ cor: true, traco: false, preenchimento: false });
  });

  it.each<CanvasShapeType>(["image", "frame"])("oculta o painel para %s", (type) => {
    expect(getCanvasPropertiesSections(type)).toBeNull();
  });

  it.each(["select", "pan", "eraser"] as const)("oculta o painel para a ferramenta %s", (tool) => {
    expect(getCanvasPropertiesSections(tool)).toBeNull();
  });
});
