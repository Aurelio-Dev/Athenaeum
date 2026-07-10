import { describe, expect, it } from "vitest";

import { createEmptyScene, parseCanvasContent, type CanvasSceneContent } from "./canvasScene";

describe("parseCanvasContent", () => {
  it("interpreta uma cena valida no formato novo", () => {
    const scene: CanvasSceneContent = {
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 12, y: -34, scale: 1.5 },
      shapes: [
        {
          id: "shape-1",
          type: "rect",
          x: 10,
          y: 20,
          width: 100,
          height: 60,
          rotation: 0,
          stroke: "#2C1A10",
          strokeWidth: 2,
          fill: null,
        },
      ],
    };

    expect(parseCanvasContent(JSON.stringify(scene))).toEqual(scene);
  });

  it("retorna cena vazia para string vazia (JSON.parse falha)", () => {
    expect(parseCanvasContent("")).toEqual(createEmptyScene());
  });

  it("retorna cena vazia para JSON malformado", () => {
    expect(parseCanvasContent("{ isto nao e json")).toEqual(createEmptyScene());
  });

  it("retorna cena vazia para o formato antigo do Excalidraw", () => {
    const excalidraw = JSON.stringify({ elements: [], appState: { viewBackgroundColor: "#fff" } });
    expect(parseCanvasContent(excalidraw)).toEqual(createEmptyScene());
  });

  it("retorna cena vazia para schemaVersion desconhecida", () => {
    const future = JSON.stringify({
      engine: "konva",
      schemaVersion: 2,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [],
    });
    expect(parseCanvasContent(future)).toEqual(createEmptyScene());
  });

  it("retorna cena vazia quando o JSON nao e um objeto", () => {
    expect(parseCanvasContent("42")).toEqual(createEmptyScene());
    expect(parseCanvasContent("null")).toEqual(createEmptyScene());
    expect(parseCanvasContent("[1, 2, 3]")).toEqual(createEmptyScene());
  });

  it("descarta formas invalidas mas preserva as validas", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "ok", type: "rect", x: 0, y: 0, width: 10, height: 10 },
        { id: "sem-tipo", x: 0, y: 0, width: 10, height: 10 },
        { type: "rect", x: 0, y: 0, width: 10, height: 10 }, // sem id
        { id: "geometria-ruim", type: "rect", x: "a", y: 0, width: 10, height: 10 },
        { id: "outra-forma", type: "ellipse", x: 0, y: 0, width: 10, height: 10 },
        "nao e objeto",
      ],
    });

    const result = parseCanvasContent(raw);
    expect(result.shapes).toEqual([
      {
        id: "ok",
        type: "rect",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        stroke: "#2C1A10",
        strokeWidth: 2,
        fill: null,
      },
    ]);
  });

  it("saneia stage com valores nao numericos ou escala invalida", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: "nao numero", y: null, scale: 0 },
      shapes: [],
    });

    expect(parseCanvasContent(raw).stage).toEqual({ x: 0, y: 0, scale: 1 });
  });
});
