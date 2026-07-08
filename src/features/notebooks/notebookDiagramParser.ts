export type DiagramNode = {
  id: string;
  label: string;
};

export type DiagramEdge = {
  id: string;
  sourceId: string;
  targetId: string;
};

export type ParsedDiagram = {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
};

export type GraphEdgeDirection = "directed" | "undirected";

export type GraphEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  direction: GraphEdgeDirection;
};

export type ParsedGraph = {
  nodes: DiagramNode[];
  edges: GraphEdge[];
};

export function parseDiagramSource(source: string): ParsedDiagram {
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const nodeIdByLabel = new Map<string, string>();
  const edgeKeys = new Set<string>();

  function getOrCreateNodeId(label: string) {
    const existingId = nodeIdByLabel.get(label);
    if (existingId) {
      return existingId;
    }

    const id = `node-${nodes.length + 1}`;
    nodeIdByLabel.set(label, id);
    nodes.push({ id, label });
    return id;
  }

  source.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return;
    }

    const relationParts = trimmedLine.split("->").map((part) => part.trim());
    if (relationParts.length < 2 || relationParts.some((part) => part.length === 0)) {
      return;
    }

    relationParts.slice(0, -1).forEach((sourceLabel, index) => {
      const targetLabel = relationParts[index + 1];
      const sourceId = getOrCreateNodeId(sourceLabel);
      const targetId = getOrCreateNodeId(targetLabel);
      const edgeKey = `${sourceId}->${targetId}`;
      if (edgeKeys.has(edgeKey)) {
        return;
      }

      edgeKeys.add(edgeKey);
      edges.push({
        id: `edge-${edges.length + 1}`,
        sourceId,
        targetId,
      });
    });
  });

  return { nodes, edges };
}

// Parser específico de "graph": além de A -> B (direcionada), aceita A -- B
// (não direcionada). Mantido separado de parseDiagramSource para não alterar o
// contrato compartilhado por diagram e flowchart.
export function parseGraphSource(source: string): ParsedGraph {
  const nodes: DiagramNode[] = [];
  const edges: GraphEdge[] = [];
  const nodeIdByLabel = new Map<string, string>();
  const edgeKeys = new Set<string>();

  function getOrCreateNodeId(label: string) {
    const existingId = nodeIdByLabel.get(label);
    if (existingId) {
      return existingId;
    }

    const id = `node-${nodes.length + 1}`;
    nodeIdByLabel.set(label, id);
    nodes.push({ id, label });
    return id;
  }

  source.split(/\r?\n/).forEach((line) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
      return;
    }

    if (trimmedLine.includes("---") || trimmedLine.includes("-->")) {
      return;
    }

    // Split com grupo de captura preserva os separadores: índices pares são
    // labels e índices ímpares são "->" ou "--".
    const segments = trimmedLine.split(/(->|--)/).map((segment) => segment.trim());
    if (segments.length < 3) {
      return;
    }

    const labels = segments.filter((_, index) => index % 2 === 0);
    const separators = segments.filter((_, index) => index % 2 === 1);
    if (labels.some((label) => label.length === 0)) {
      return;
    }

    separators.forEach((separator, index) => {
      const sourceId = getOrCreateNodeId(labels[index]);
      const targetId = getOrCreateNodeId(labels[index + 1]);
      const direction: GraphEdgeDirection = separator === "--" ? "undirected" : "directed";
      // Aresta não direcionada é a mesma nos dois sentidos, então a chave de
      // deduplicação ignora a ordem dos nós.
      const edgeKey =
        direction === "directed"
          ? `${sourceId}->${targetId}`
          : [sourceId, targetId].sort().join("--");
      if (edgeKeys.has(edgeKey)) {
        return;
      }

      edgeKeys.add(edgeKey);
      edges.push({
        id: `edge-${edges.length + 1}`,
        sourceId,
        targetId,
        direction,
      });
    });
  });

  return { nodes, edges };
}
