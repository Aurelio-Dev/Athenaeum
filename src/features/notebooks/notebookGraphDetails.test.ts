import { describe, expect, it } from "vitest";

import { parseGraphSource } from "./notebookDiagramParser";
import {
  buildGraphDetailsModel,
  renderGraphDetailsHtml,
  type GraphDetailsModel,
} from "./notebookGraphDetails";

function modelFor(source: string): GraphDetailsModel {
  const model = buildGraphDetailsModel(parseGraphSource(source));
  if (!model) {
    throw new Error("Modelo de detalhes inesperadamente nulo.");
  }
  return model;
}

describe("buildGraphDetailsModel", () => {
  it("identifies a simple undirected cycle with C_n and ordered V and E", () => {
    const model = modelFor("A -- B\nB -- C\nC -- A");

    expect(model.identification).toEqual({
      symbol: "C",
      subscript: "3",
      description: "grafo ciclo com 3 vértices",
    });
    expect(model.vertices.map((item) => item.content)).toEqual(["A", "B", "C"]);
    expect(model.edges.map((item) => item.content)).toEqual(["{A, B}", "{B, C}", "{C, A}"]);
  });

  it("keeps cycle vertex and edge order deterministic regardless of source line order", () => {
    const first = modelFor("A -- B\nB -- C\nC -- A");
    const shuffled = modelFor("C -- A\nB -- C\nA -- B");

    expect(shuffled.vertices.map((item) => item.content)).toEqual(
      first.vertices.map((item) => item.content),
    );
    expect(shuffled.edges.map((item) => item.content)).toEqual(first.edges.map((item) => item.content));
  });

  it("shows V and E for a directed graph without inventing an identification", () => {
    const model = modelFor("A -> B\nB -> C");

    expect(model.identification).toBeNull();
    expect(model.vertices.map((item) => item.content)).toEqual(["A", "B", "C"]);
    expect(model.edges.map((item) => item.content)).toEqual(["(A, B)", "(B, C)"]);
  });

  it("uses set notation for undirected edges of a non-cycle graph", () => {
    const model = modelFor("A -- B\nA -- C");

    expect(model.identification).toBeNull();
    expect(model.edges.map((item) => item.content)).toEqual(["{A, B}", "{A, C}"]);
  });

  it("preserves the original (untruncated) label in V and E", () => {
    const longLabel = "Servidor de Autenticação Principal";
    const model = modelFor(`${longLabel} -> B`);

    expect(model.vertices.map((item) => item.content)).toContain(longLabel);
    expect(model.edges.map((item) => item.content)).toEqual([`(${longLabel}, B)`]);
  });

  it("returns null when there are no vertices", () => {
    expect(buildGraphDetailsModel({ nodes: [], edges: [] })).toBeNull();
  });
});

describe("renderGraphDetailsHtml", () => {
  it("renders identification, V and E as sibling selectable text (not inside an SVG)", () => {
    const html = renderGraphDetailsHtml(modelFor("A -- B\nB -- C\nC -- A"));

    expect(html).toContain('class="athenaeum-export__graph-details"');
    expect(html).toContain("<sub>3</sub>");
    expect(html).toContain("grafo ciclo com 3 vértices");
    expect(html).toContain(">V</span>");
    expect(html).toContain(">E</span>");
    expect(html).toContain("{A, B}");
    expect(html).not.toContain("<svg");
  });

  it("omits the identification line for a graph without a computed name", () => {
    const html = renderGraphDetailsHtml(modelFor("A -> B\nB -> C"));

    expect(html).not.toContain("athenaeum-export__graph-identification");
    expect(html).toContain(">V</span>");
    expect(html).toContain("(A, B)");
  });

  it("escapes vertex and edge labels so they cannot inject markup", () => {
    const html = renderGraphDetailsHtml(modelFor('<script>alert(1)</script> -> "B"'));

    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;B&quot;");
    expect(html).not.toContain('"B"</span>');
  });

  it("preserves valid Unicode and mathematical characters", () => {
    const html = renderGraphDetailsHtml(modelFor("α₁ -- β₂\nβ₂ -- γ₃\nγ₃ -- α₁"));

    expect(html).toContain("α₁");
    expect(html).toContain("β₂");
    expect(html).toContain("γ₃");
  });

  it("emits one selectable item per vertex so large sets can wrap naturally", () => {
    const source = Array.from({ length: 12 }, (_, index) => `N${index} -> N${index + 1}`).join("\n");
    const html = renderGraphDetailsHtml(modelFor(source));
    const itemCount = html.match(/class="athenaeum-export__graph-item"/g)?.length ?? 0;

    // 13 vértices (N0..N12) + 12 arestas = 25 itens, cada um em seu próprio span
    // que o CSS pode quebrar em nova linha.
    expect(itemCount).toBe(25);
  });
});
