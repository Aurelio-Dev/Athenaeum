import { describe, expect, it } from "vitest";

import { renderNotebookDiagramStaticSvg } from "./notebookDiagramStaticSvg";

describe("renderNotebookDiagramStaticSvg", () => {
  it("renders a directed diagram as escaped static SVG with scale", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "diagram",
      source: "Entrada -> <Saida>",
      scale: "150",
      idPrefix: "export-diagram-1",
    });

    expect(result.status).toBe("rendered");
    expect(result.scalePercent).toBe(150);
    expect(result.html).toContain("<svg");
    expect(result.html).toContain('width="594"');
    expect(result.html).toContain('height="129"');
    expect(result.html).toContain("Entrada");
    expect(result.html).toContain("&lt;Saida&gt;");
    expect(result.html).not.toContain("<Saida>");
    expect(result.html).toContain('marker-end="url(#export-diagram-1-arrow)"');
  });

  it("renders graph edges with arrows only for directed relations", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -> C",
      idPrefix: "export-graph-1",
    });

    expect(result.status).toBe("rendered");
    expect(result.html).toContain('class="notebook-graph-visual"');
    expect(result.html.match(/marker-end="/g)).toHaveLength(1);
    expect(result.html).toContain('marker-end="url(#export-graph-1-arrow)"');
  });

  it("uses the cycle SVG layout for simple undirected cycle graphs", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "1 -- 2\n2 -- 3\n3 -- 1",
    });

    expect(result.status).toBe("rendered");
    expect(result.html).toContain("notebook-graph-visual--cycle");
    expect(result.html).toContain("Grafo ciclo com 3 vertices e 3 arestas");
  });

  it("renders flowchart terminal nodes with the terminal class", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "flowchart",
      source: "Inicio -> Processo\nProcesso -> Fim",
      scale: "valor-invalido",
    });

    expect(result.status).toBe("rendered");
    expect(result.scalePercent).toBe(100);
    expect(result.html).toContain("notebook-flowchart-visual-node--terminal");
    expect(result.html).toContain("Fluxograma com 3 etapas e 2 conexoes");
  });

  it("renders a visible escaped fallback for invalid diagram syntax", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "diagram",
      source: "Texto solto <b>",
    });

    expect(result.status).toBe("fallback");
    expect(result.html).toContain("Nenhuma relacao valida encontrada");
    expect(result.html).toContain("Texto solto &lt;b&gt;");
    expect(result.html).not.toContain("<svg");
    expect(result.html).not.toContain("<b>");
  });
});

describe("renderNotebookDiagramStaticSvg (detalhes do grafo)", () => {
  it("exports the SVG together with the graph details for a valid cycle graph", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
    });

    expect(result.status).toBe("rendered");
    expect(result.hasGraphDetails).toBe(true);
    expect(result.html).toContain("<svg");
    expect(result.html).toContain('class="athenaeum-export__graph-layout"');
    expect(result.html).toContain('class="athenaeum-export__graph-details"');
    // Identificação, V e E.
    expect(result.html).toContain("<sub>3</sub>");
    expect(result.html).toContain("grafo ciclo com 3 vértices");
    expect(result.html).toContain("{A, B}");
    expect(result.html).toContain("{C, A}");
  });

  it("keeps the details outside of the SVG element", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
    });

    const svgClose = result.html.indexOf("</svg>");
    const detailsStart = result.html.indexOf("athenaeum-export__graph-details");
    expect(svgClose).toBeGreaterThan(-1);
    expect(detailsStart).toBeGreaterThan(svgClose);
    // O SVG em si não contém o bloco textual de detalhes.
    const svgMarkup = result.html.slice(result.html.indexOf("<svg"), svgClose);
    expect(svgMarkup).not.toContain("athenaeum-export__graph-details");
  });

  it("shows the details only once (no duplication)", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
    });

    expect(result.html.match(/athenaeum-export__graph-details/g)).toHaveLength(1);
    expect(result.html.match(/grafo ciclo com 3 vértices/g)).toHaveLength(1);
  });

  it("shows V and E without an identification line for a directed graph", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -> B\nB -> C",
    });

    expect(result.status).toBe("rendered");
    expect(result.hasGraphDetails).toBe(true);
    expect(result.html).toContain('class="athenaeum-export__graph-details"');
    expect(result.html).not.toContain("athenaeum-export__graph-identification");
    expect(result.html).toContain("(A, B)");
  });

  it("does not leak the raw diagram source syntax into the exported graph", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -> B\nB -> C",
    });

    expect(result.html).not.toContain(" -> ");
    expect(result.html).not.toContain(" -- ");
  });

  it("keeps the persisted scale on the block while rendering the SVG at natural size", () => {
    const resized = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
      scale: "140",
    });
    const natural = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
    });

    // A escala persistida é preservada para o bloco, mas o SVG não recebe
    // transform: scale() nem largura ampliada (sizing igual ao natural).
    expect(resized.scalePercent).toBe(140);
    expect(resized.html).not.toContain("transform: scale(");
    const resizedWidth = resized.html.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1];
    const naturalWidth = natural.html.match(/<svg[^>]*\swidth="([\d.]+)"/)?.[1];
    expect(resizedWidth).toBe(naturalWidth);
  });

  it("keeps working for a legacy graph without a scale attribute", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
    });

    expect(result.scalePercent).toBe(100);
    expect(result.hasGraphDetails).toBe(true);
    expect(result.html).toContain("<svg");
  });

  it("preserves the current fallback for an invalid or empty graph (no details)", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "somente texto",
    });

    expect(result.status).toBe("fallback");
    expect(result.hasGraphDetails).toBe(false);
    expect(result.html).not.toContain("athenaeum-export__graph-details");
    expect(result.html).not.toContain("<svg");
  });

  it("does not add graph details to non-graph diagrams", () => {
    const diagram = renderNotebookDiagramStaticSvg({ kind: "diagram", source: "A -> B" });
    const flowchart = renderNotebookDiagramStaticSvg({
      kind: "flowchart",
      source: "Início -> Fim",
    });

    expect(diagram.hasGraphDetails).toBe(false);
    expect(diagram.html).not.toContain("athenaeum-export__graph-details");
    expect(flowchart.hasGraphDetails).toBe(false);
    expect(flowchart.html).not.toContain("athenaeum-export__graph-details");
  });

  it("does not emit runtime controls, contenteditable or scale transforms", () => {
    const result = renderNotebookDiagramStaticSvg({
      kind: "graph",
      source: "A -- B\nB -- C\nC -- A",
    });

    expect(result.html).not.toContain("contenteditable");
    expect(result.html).not.toContain("notebook-diagram-resize-handle");
    expect(result.html).not.toContain("notebook-diagram-frame");
    expect(result.html).not.toContain("transform: scale(");
  });
});
