import type { ParsedGraph } from "./notebookDiagramParser";
import { detectSimpleCycle } from "./notebookGraphAnalysis";

// Modelo textual do grafo (identificação, V e E) derivado da mesma fonte de
// verdade do editor: o parser (parseGraphSource) para V e E, e a análise de
// ciclo (detectSimpleCycle) para a identificação e a ordem determinística. É
// puro e sem React/DOM, para ser reutilizado tanto pela pré-visualização do
// editor quanto pela exportação HTML, evitando uma segunda implementação que
// possa divergir.

export type GraphDetailsItem = {
  key: string;
  content: string;
};

// Vértice ordenado (id + label original). O label nunca é truncado aqui:
// truncar é decisão exclusiva do desenho SVG, nunca da identificação textual.
export type OrderedVertex = {
  id: string;
  label: string;
};

export type GraphDetailsIdentification = {
  // Símbolo matemático (ex.: "C") e seu subscrito (ex.: "5"), renderizados como
  // C com índice inferior. A descrição é o texto legível ("grafo ciclo com 5
  // vértices").
  symbol: string;
  subscript: string;
  description: string;
};

export type GraphDetailsModel = {
  identification: GraphDetailsIdentification | null;
  vertices: GraphDetailsItem[];
  edges: GraphDetailsItem[];
};

// Texto legível da identificação de um ciclo. Compartilhado entre editor e
// exportação para que a frase não divirja entre os dois.
export function describeCycle(vertexCount: number): string {
  return `grafo ciclo com ${vertexCount} vértices`;
}

// V de um ciclo: labels na ordem de percurso, sem truncar.
export function buildCycleVertexItems(vertices: OrderedVertex[]): GraphDetailsItem[] {
  return vertices.map((vertex) => ({ key: vertex.id, content: vertex.label }));
}

// E de um ciclo: pares não ordenados {A, B} entre vértices consecutivos,
// fechando no primeiro. Determinístico pela ordem de percurso do ciclo.
export function buildCycleEdgeItems(vertices: OrderedVertex[]): GraphDetailsItem[] {
  return vertices.map((vertex, index) => {
    const nextVertex = vertices[(index + 1) % vertices.length];
    return {
      key: `${vertex.id}-${nextVertex.id}`,
      content: `{${vertex.label}, ${nextVertex.label}}`,
    };
  });
}

function formatUndirectedEdge(sourceLabel: string, targetLabel: string) {
  return `{${sourceLabel}, ${targetLabel}}`;
}

function formatDirectedEdge(sourceLabel: string, targetLabel: string) {
  return `(${sourceLabel}, ${targetLabel})`;
}

// Constrói o modelo textual do grafo. Retorna null apenas quando não há
// vértices (nesse caso a exportação mantém só o fallback do SVG). A
// identificação existe apenas quando a análise reconhece um ciclo simples;
// para os demais grafos, V e E continuam sendo mostrados (fonte de verdade é o
// parser), sem inventar um nome matemático.
export function buildGraphDetailsModel(graph: ParsedGraph): GraphDetailsModel | null {
  if (graph.nodes.length === 0) {
    return null;
  }

  const labelById = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const cycle = detectSimpleCycle(graph);

  if (cycle) {
    const orderedVertices: OrderedVertex[] = cycle.vertexIds.map((id) => ({
      id,
      label: labelById.get(id) ?? id,
    }));
    const vertexCount = orderedVertices.length;

    return {
      identification: {
        symbol: "C",
        subscript: String(vertexCount),
        description: describeCycle(vertexCount),
      },
      vertices: buildCycleVertexItems(orderedVertices),
      edges: buildCycleEdgeItems(orderedVertices),
    };
  }

  // Grafo geral: V e E na ordem de inserção do parser (determinística). Arestas
  // dirigidas viram pares ordenados (A, B); não dirigidas, conjuntos {A, B}.
  const vertices: GraphDetailsItem[] = graph.nodes.map((node) => ({
    key: node.id,
    content: node.label,
  }));
  const edges: GraphDetailsItem[] = graph.edges.map((edge) => {
    const sourceLabel = labelById.get(edge.sourceId) ?? edge.sourceId;
    const targetLabel = labelById.get(edge.targetId) ?? edge.targetId;
    const content =
      edge.direction === "directed"
        ? formatDirectedEdge(sourceLabel, targetLabel)
        : formatUndirectedEdge(sourceLabel, targetLabel);

    return { key: edge.id, content };
  });

  return { identification: null, vertices, edges };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderSet(variable: string, items: GraphDetailsItem[]): string {
  const inner = items
    .map((item, index) => {
      const separator = index < items.length - 1 ? ", " : "";
      return `<span class="athenaeum-export__graph-item">${escapeHtml(item.content)}${separator}</span>`;
    })
    .join("");

  return (
    `<p class="athenaeum-export__graph-set">` +
    `<span class="athenaeum-export__graph-variable">${escapeHtml(variable)}</span>` +
    `<span class="athenaeum-export__graph-set-glyph"> = {</span>` +
    `${inner}` +
    `<span class="athenaeum-export__graph-set-glyph">}</span>` +
    `</p>`
  );
}

// HTML estático e seguro dos detalhes do grafo. Todo texto derivado do grafo
// (labels e conjuntos) é escapado; a estrutura é selecionável, pesquisável e
// copiável, e é irmã do SVG (nunca renderizada dentro dele).
export function renderGraphDetailsHtml(model: GraphDetailsModel): string {
  const identificationHtml = model.identification
    ? `<p class="athenaeum-export__graph-identification">` +
      `<span class="athenaeum-export__graph-variable">${escapeHtml(model.identification.symbol)}` +
      `<sub>${escapeHtml(model.identification.subscript)}</sub></span>` +
      `: ${escapeHtml(model.identification.description)}` +
      `</p>`
    : "";

  return (
    `<div class="athenaeum-export__graph-details">` +
    `${identificationHtml}` +
    `${renderSet("V", model.vertices)}` +
    `${renderSet("E", model.edges)}` +
    `</div>`
  );
}
