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
