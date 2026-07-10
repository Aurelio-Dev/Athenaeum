import { describe, expect, it } from "vitest";

import { eraseAlongSegment } from "./canvasEraser";
import type { CanvasShape } from "./canvasScene";

// Monta uma forma completa com defaults do schema; overrides por teste.
function buildShape(overrides: Partial<CanvasShape> & Pick<CanvasShape, "id" | "type">): CanvasShape {
  return {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    points: [],
    rotation: 0,
    stroke: "#2C1A10",
    strokeWidth: 2,
    fill: null,
    text: "",
    fontSize: 16,
    ...overrides,
  };
}

describe("eraseAlongSegment", () => {
  it("corta um traco de lapis no meio, gerando dois tracos novos", () => {
    // Traco horizontal com pontos a cada 10px; borracha vertical cruzando x=20.
    const stroke = buildShape({
      id: "original",
      type: "freedraw",
      x: 0,
      y: 0,
      width: 40,
      height: 0,
      points: [0, 0, 10, 0, 20, 0, 30, 0, 40, 0],
    });

    const result = eraseAlongSegment([stroke], { x: 20, y: -10 }, { x: 20, y: 10 }, 5);

    expect(result).toHaveLength(2);
    const [left, right] = result;
    // Fragmento esquerdo: pontos absolutos (0,0) e (10,0).
    expect(left.type).toBe("freedraw");
    expect(left.x).toBe(0);
    expect(left.y).toBe(0);
    expect(left.points).toEqual([0, 0, 10, 0]);
    expect(left.width).toBe(10);
    // Fragmento direito: ancora recalculada no primeiro ponto do run (30,0).
    expect(right.x).toBe(30);
    expect(right.y).toBe(0);
    expect(right.points).toEqual([0, 0, 10, 0]);
    // Ids novos e unicos (nao reusa o id do traco original).
    expect(left.id).not.toBe("original");
    expect(right.id).not.toBe("original");
    expect(left.id).not.toBe(right.id);
  });

  it("apaga o traco de lapis inteiro quando totalmente coberto", () => {
    const stroke = buildShape({
      id: "todo-coberto",
      type: "freedraw",
      points: [0, 0, 10, 0, 20, 0],
    });

    const result = eraseAlongSegment([stroke], { x: 10, y: 0 }, { x: 10, y: 0 }, 100);
    expect(result).toEqual([]);
  });

  it("corta a ponta do traco gerando um unico fragmento", () => {
    const stroke = buildShape({
      id: "ponta",
      type: "freedraw",
      points: [0, 0, 10, 0, 20, 0, 30, 0],
    });

    // Borracha sobre o primeiro ponto (0,0) apenas.
    const result = eraseAlongSegment([stroke], { x: 0, y: -4 }, { x: 0, y: 4 }, 5);

    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(10);
    expect(result[0].points).toEqual([0, 0, 10, 0, 20, 0]);
  });

  it("nao altera traco de lapis longe do segmento (mesma referencia e id)", () => {
    const stroke = buildShape({
      id: "longe",
      type: "freedraw",
      points: [0, 0, 10, 0],
    });
    const shapes = [stroke];

    const result = eraseAlongSegment(shapes, { x: 1000, y: 1000 }, { x: 1010, y: 1010 }, 12);

    // Mesma referencia de array e de forma: nada mudou.
    expect(result).toBe(shapes);
    expect(result[0]).toBe(stroke);
    expect(result[0].id).toBe("longe");
  });

  it("remove retangulo inteiro quando a borracha toca so uma borda", () => {
    const rect = buildShape({ id: "r", type: "rect", x: 0, y: 0, width: 40, height: 30 });

    // Segmento vertical proximo da borda esquerda (x=0), longe do interior.
    const result = eraseAlongSegment([rect], { x: -4, y: 5 }, { x: -4, y: 25 }, 5);
    expect(result).toEqual([]);
  });

  it("remove elipse e seta tocadas pelo segmento", () => {
    const ellipse = buildShape({ id: "e", type: "ellipse", x: 0, y: 0, width: 40, height: 30 });
    // Ponto mais a direita da elipse: (40, 15).
    expect(eraseAlongSegment([ellipse], { x: 45, y: 15 }, { x: 50, y: 15 }, 6)).toEqual([]);

    const arrow = buildShape({ id: "a", type: "arrow", x: 0, y: 0, width: 50, height: 50, points: [0, 0, 50, 50] });
    // Segmento cruzando o meio da seta (~(25,25)).
    expect(eraseAlongSegment([arrow], { x: 30, y: 20 }, { x: 20, y: 30 }, 5)).toEqual([]);
  });

  it("mantem retangulo longe do segmento (mesma referencia)", () => {
    const rect = buildShape({ id: "intacto", type: "rect", x: 0, y: 0, width: 40, height: 30 });
    const shapes = [rect];

    const result = eraseAlongSegment(shapes, { x: 200, y: 200 }, { x: 220, y: 220 }, 12);
    expect(result).toBe(shapes);
  });

  it("detecta forma no meio de um segmento rapido (distancia ponto-segmento, nao ponto-ponto)", () => {
    // Retangulo pequeno no MEIO do caminho de um movimento rapido do mouse:
    // from e to estao a ~140px da forma; so a checagem contra o segmento
    // inteiro detecta o toque (ponto-ponto contra os extremos falharia).
    const rect = buildShape({ id: "no-caminho", type: "rect", x: 100, y: 100, width: 10, height: 10 });

    const from = { x: 0, y: 0 };
    const to = { x: 200, y: 200 };
    // Sanidade do cenario: os extremos do segmento estao bem alem do raio.
    expect(Math.hypot(100 - from.x, 100 - from.y)).toBeGreaterThan(100);
    expect(Math.hypot(100 - to.x, 100 - to.y)).toBeGreaterThan(100);

    const result = eraseAlongSegment([rect], from, to, 5);
    expect(result).toEqual([]);
  });

  it("fragmentos de lapis preservam o estilo do traco original", () => {
    const stroke = buildShape({
      id: "estiloso",
      type: "freedraw",
      stroke: "#123456",
      strokeWidth: 5,
      points: [0, 0, 10, 0, 20, 0, 30, 0, 40, 0],
    });

    const result = eraseAlongSegment([stroke], { x: 20, y: -10 }, { x: 20, y: 10 }, 5);
    expect(result).toHaveLength(2);
    for (const fragment of result) {
      expect(fragment.stroke).toBe("#123456");
      expect(fragment.strokeWidth).toBe(5);
      expect(fragment.fill).toBeNull();
    }
  });

  it("nao mexe nas formas vizinhas ao cortar um traco", () => {
    const untouched = buildShape({ id: "vizinho", type: "rect", x: 500, y: 500, width: 20, height: 20 });
    const stroke = buildShape({
      id: "cortado",
      type: "freedraw",
      points: [0, 0, 10, 0, 20, 0, 30, 0, 40, 0],
    });

    const result = eraseAlongSegment([untouched, stroke], { x: 20, y: -10 }, { x: 20, y: 10 }, 5);
    expect(result).toHaveLength(3);
    // O retangulo distante permanece o MESMO objeto, na mesma posicao do array.
    expect(result[0]).toBe(untouched);
  });
});
