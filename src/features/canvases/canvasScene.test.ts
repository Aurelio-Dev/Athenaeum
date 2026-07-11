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
          points: [],
          rotation: 0,
          stroke: "#2C1A10",
          strokeWidth: 2,
          fill: null,
          fillStyle: "none",
          text: "",
          fontSize: 16,
          fileId: null,
        },
      ],
    };

    expect(parseCanvasContent(JSON.stringify(scene))).toEqual(scene);
  });

  it("aceita os tipos novos e preserva points nas formas direcionais", () => {
    const scene: CanvasSceneContent = {
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "d", type: "diamond", x: 0, y: 0, width: 40, height: 40, points: [], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "solid", text: "", fontSize: 16, fileId: null },
        { id: "e", type: "ellipse", x: 5, y: 5, width: 30, height: 20, points: [], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "hachure", text: "", fontSize: 16, fileId: null },
        { id: "a", type: "arrow", x: 0, y: 0, width: 50, height: 10, points: [0, 0, 50, 10], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "none", text: "", fontSize: 16, fileId: null },
        { id: "l", type: "line", x: 1, y: 2, width: 30, height: 0, points: [0, 0, 30, 0], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "none", text: "", fontSize: 16, fileId: null },
        { id: "f", type: "freedraw", x: 3, y: 4, width: 20, height: 12, points: [0, 0, 5, 6, 12, 3, 20, 12], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "none", text: "", fontSize: 16, fileId: null },
        { id: "t", type: "text", x: 8, y: 9, width: 72, height: 38, points: [], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "none", text: "Linha 1\nLinha 2", fontSize: 18, fileId: null },
        { id: "i", type: "image", x: 12, y: 14, width: 320, height: 180, points: [], rotation: 0, stroke: "#2C1A10", strokeWidth: 2, fill: null, fillStyle: "none", text: "", fontSize: 16, fileId: "file-1" },
        { id: "fr", type: "frame", x: 20, y: 25, width: 400, height: 240, points: [], rotation: 0, stroke: "#7A6558", strokeWidth: 2, fill: null, fillStyle: "cross-hatch", text: "", fontSize: 16, fileId: null },
      ],
    };

    expect(parseCanvasContent(JSON.stringify(scene))).toEqual(scene);
  });

  it("aplica fontSize 16 por padrao e descarta textos vazios", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "texto", type: "text", x: 10, y: 20, width: 42, height: 20, text: "Athenaeum" },
        { id: "vazio", type: "text", x: 0, y: 0, width: 0, height: 0, text: "" },
        { id: "espacos", type: "text", x: 0, y: 0, width: 0, height: 0, text: "  \n " },
      ],
    });

    expect(parseCanvasContent(raw).shapes).toEqual([
      {
        id: "texto",
        type: "text",
        x: 10,
        y: 20,
        width: 42,
        height: 20,
        points: [],
        rotation: 0,
        stroke: "#2C1A10",
        strokeWidth: 2,
        fill: null,
        fillStyle: "none",
        text: "Athenaeum",
        fontSize: 16,
        fileId: null,
      },
    ]);
  });

  it("preserva fillStyle valido e usa none quando ausente ou invalido", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "antiga", type: "rect", x: 0, y: 0, width: 20, height: 10 },
        { id: "solida", type: "rect", x: 0, y: 0, width: 20, height: 10, fillStyle: "solid" },
        { id: "hachurada", type: "rect", x: 0, y: 0, width: 20, height: 10, fillStyle: "hachure" },
        { id: "cruzada", type: "rect", x: 0, y: 0, width: 20, height: 10, fillStyle: "cross-hatch" },
        { id: "invalida", type: "rect", x: 0, y: 0, width: 20, height: 10, fillStyle: "gradiente" },
      ],
    });

    expect(parseCanvasContent(raw).shapes.map((shape) => shape.fillStyle)).toEqual([
      "none",
      "solid",
      "hachure",
      "cross-hatch",
      "none",
    ]);
  });

  it("descarta imagens sem fileId e preserva imagens referenciadas", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "sem-id", type: "image", x: 0, y: 0, width: 100, height: 80 },
        { id: "id-vazio", type: "image", x: 0, y: 0, width: 100, height: 80, fileId: "" },
        { id: "id-espacos", type: "image", x: 0, y: 0, width: 100, height: 80, fileId: "   " },
        { id: "valida", type: "image", x: 5, y: 6, width: 100, height: 80, fileId: "asset-1" },
      ],
    });

    const result = parseCanvasContent(raw);
    expect(result.shapes).toHaveLength(1);
    expect(result.shapes[0]).toMatchObject({ id: "valida", type: "image", fileId: "asset-1" });
  });

  it("preserva frame valido e aplica a regra atual de caixas a dimensoes negativas", () => {
    const validFrame = {
      id: "frame-valido",
      type: "frame",
      x: 24,
      y: 36,
      width: 320,
      height: 180,
      points: [],
      rotation: 0,
      stroke: "#7A6558",
      strokeWidth: 2,
      fill: null,
      fillStyle: "none",
      text: "",
      fontSize: 16,
      fileId: null,
    };
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        validFrame,
        { ...validFrame, id: "frame-width-negativo", width: -120 },
        { ...validFrame, id: "frame-height-negativo", height: -80 },
      ],
    });

    const result = parseCanvasContent(raw);
    expect(result.shapes[0]).toEqual(validFrame);
    // O parser atual preserva dimensoes finitas negativas em todas as formas de
    // caixa; a normalizacao para valores positivos acontece na criacao por arrasto.
    expect(result.shapes[1]).toMatchObject({ id: "frame-width-negativo", width: -120, height: 180 });
    expect(result.shapes[2]).toMatchObject({ id: "frame-height-negativo", width: 320, height: -80 });
  });

  it("descarta freedraw com menos de dois pontos", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "f-vazio", type: "freedraw", x: 0, y: 0, width: 0, height: 0, points: [] },
        { id: "f-um-ponto", type: "freedraw", x: 0, y: 0, width: 0, height: 0, points: [1, 2] },
        { id: "f-ok", type: "freedraw", x: 0, y: 0, width: 10, height: 4, points: [0, 0, 10, 4] },
      ],
    });

    const result = parseCanvasContent(raw);
    expect(result.shapes.map((shape) => shape.id)).toEqual(["f-ok"]);
  });

  it("descarta seta/linha sem os dois pontos e descarta points invalidos", () => {
    const raw = JSON.stringify({
      engine: "konva",
      schemaVersion: 1,
      stage: { x: 0, y: 0, scale: 1 },
      shapes: [
        { id: "arrow-sem-pontos", type: "arrow", x: 0, y: 0, width: 10, height: 10 },
        { id: "line-um-ponto", type: "line", x: 0, y: 0, width: 10, height: 10, points: [0, 0] },
        { id: "rect-points-ruins", type: "rect", x: 0, y: 0, width: 10, height: 10, points: [1, "x", 3] },
      ],
    });

    const result = parseCanvasContent(raw);
    // As duas direcionais sao descartadas; o rect fica com points saneado para [].
    expect(result.shapes).toEqual([
      {
        id: "rect-points-ruins",
        type: "rect",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        points: [],
        rotation: 0,
        stroke: "#2C1A10",
        strokeWidth: 2,
        fill: null,
        fillStyle: "none",
        text: "",
        fontSize: 16,
        fileId: null,
      },
    ]);
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
        { id: "tipo-desconhecido", type: "star", x: 0, y: 0, width: 10, height: 10 },
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
        points: [],
        rotation: 0,
        stroke: "#2C1A10",
        strokeWidth: 2,
        fill: null,
        fillStyle: "none",
        text: "",
        fontSize: 16,
        fileId: null,
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
