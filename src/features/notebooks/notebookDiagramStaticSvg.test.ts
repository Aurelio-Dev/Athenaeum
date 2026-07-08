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
