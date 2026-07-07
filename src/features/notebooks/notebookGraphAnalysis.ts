import type { ParsedGraph } from "./notebookDiagramParser";

export type SimpleCycle = {
  // Ids dos vértices na ordem de percurso do ciclo, começando no vértice de
  // menor label e seguindo pelo vizinho de menor label — determinístico e
  // independente da ordem das linhas da fonte.
  vertexIds: string[];
};

function compareLabels(a: string, b: string) {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "variant" });
}

// Detecta um ciclo simples não direcionado: pelo menos 3 vértices, conectado,
// todo vértice com grau exatamente 2, |E| = |V|, sem self-loop e sem arestas
// direcionadas. Grafos que não satisfazem tudo isso retornam null.
export function detectSimpleCycle(graph: ParsedGraph): SimpleCycle | null {
  const nodeCount = graph.nodes.length;
  if (nodeCount < 3 || graph.edges.length !== nodeCount) {
    return null;
  }

  const hasInvalidEdge = graph.edges.some(
    (edge) => edge.direction !== "undirected" || edge.sourceId === edge.targetId,
  );
  if (hasInvalidEdge) {
    return null;
  }

  const neighborsById = new Map<string, string[]>(graph.nodes.map((node) => [node.id, []]));
  for (const edge of graph.edges) {
    const sourceNeighbors = neighborsById.get(edge.sourceId);
    const targetNeighbors = neighborsById.get(edge.targetId);
    if (!sourceNeighbors || !targetNeighbors) {
      return null;
    }

    sourceNeighbors.push(edge.targetId);
    targetNeighbors.push(edge.sourceId);
  }

  for (const neighbors of neighborsById.values()) {
    if (neighbors.length !== 2) {
      return null;
    }
  }

  const labelById = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const startId = graph.nodes
    .map((node) => node.id)
    .sort((a, b) => compareLabels(labelById.get(a) ?? "", labelById.get(b) ?? ""))[0];
  const startNeighbors = startId ? neighborsById.get(startId) : undefined;
  if (!startId || !startNeighbors) {
    return null;
  }

  const [firstNeighbor, secondNeighbor] = [...startNeighbors].sort((a, b) =>
    compareLabels(labelById.get(a) ?? "", labelById.get(b) ?? ""),
  );

  const nextFromStart = firstNeighbor ?? secondNeighbor;
  if (!nextFromStart) {
    return null;
  }

  const vertexIds = [startId];
  let previousId = startId;
  let currentId = nextFromStart;

  while (currentId !== startId) {
    if (vertexIds.includes(currentId)) {
      return null;
    }

    vertexIds.push(currentId);
    const neighbors = neighborsById.get(currentId);
    if (!neighbors) {
      return null;
    }

    const nextId = neighbors.find((neighborId) => neighborId !== previousId);
    if (!nextId) {
      return null;
    }

    previousId = currentId;
    currentId = nextId;
  }

  // Percurso fechou antes de visitar todos os vértices: grafo desconectado
  // (dois ou mais ciclos disjuntos).
  if (vertexIds.length !== nodeCount) {
    return null;
  }

  return { vertexIds };
}
