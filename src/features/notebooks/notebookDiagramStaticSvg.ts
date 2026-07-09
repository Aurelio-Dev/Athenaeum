import { parseDiagramSource, parseGraphSource, type ParsedDiagram, type ParsedGraph } from "./notebookDiagramParser";
import { diagramScaleDefaultPercent, parseDiagramScale } from "./notebookDiagramScale";
import { detectSimpleCycle, type SimpleCycle } from "./notebookGraphAnalysis";
import { buildGraphDetailsModel, renderGraphDetailsHtml } from "./notebookGraphDetails";
import { diagramKindLabels, isDiagramKind, type DiagramKind } from "./notebookEditorUtils";

export type NotebookDiagramStaticSvgRenderStatus = "rendered" | "fallback";

export type NotebookDiagramStaticSvgRenderResult = {
  kind: DiagramKind;
  status: NotebookDiagramStaticSvgRenderStatus;
  html: string;
  source: string;
  scalePercent: number;
  // Verdadeiro quando o HTML traz o bloco textual de detalhes do grafo
  // (identificação, V e E) ao lado do SVG. Usado pela exportação para marcar a
  // figura com a classe do layout de grafo.
  hasGraphDetails: boolean;
};

export type RenderNotebookDiagramStaticSvgInput = {
  kind?: string | null;
  source: string;
  scale?: string | null;
  idPrefix?: string;
};

const diagramMinNodeWidth = 144;
const diagramNodeHeight = 46;
const diagramNodeGap = 52;
const diagramHorizontalPadding = 28;
const diagramVerticalPadding = 20;
const diagramEstimatedCharacterWidth = 7.3;
const diagramNodeHorizontalPadding = 40;
const diagramArrowInset = 5;

const graphMinNodeWidth = 136;
const graphNodeHeight = 42;
const graphColumnGap = 44;
const graphRowGap = 42;
const graphHorizontalPadding = 28;
const graphVerticalPadding = 20;
const graphEstimatedCharacterWidth = 7.1;
const graphNodeHorizontalPadding = 38;
const graphArrowInset = 5;

const cycleVertexRadius = 5;
const cycleLabelGap = 12;
const cycleLabelHalfHeight = 7;
const cycleLabelCharacterLimit = 16;
const cyclePadding = 18;
const cycleMinChordLength = 46;

const flowchartMinNodeWidth = 176;
const flowchartMaxNodeWidth = 280;
const flowchartNodeHeight = 42;
const flowchartNodeGap = 24;
const flowchartHorizontalPadding = 42;
const flowchartVerticalPadding = 18;
const flowchartMaxLabelCharacters = 34;
const flowchartEstimatedCharacterWidth = 7.1;
const flowchartNodeHorizontalPadding = 40;
const flowchartArrowInset = 5;
const flowchartSideLaneOffset = 22;
const flowchartSideLaneBendOffset = 12;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatNumber(value: number) {
  const rounded = Math.round(value * 1000) / 1000;

  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return String(rounded).replace(/\.?0+$/, "");
}

function truncateLabel(label: string, maxLabelCharacters: number) {
  const normalizedLabel = label.replace(/\s+/g, " ").trim();
  const labelCharacters = Array.from(normalizedLabel);

  if (labelCharacters.length <= maxLabelCharacters) {
    return normalizedLabel;
  }

  return `${labelCharacters.slice(0, maxLabelCharacters - 3).join("")}...`;
}

function getScalePercent(scale: string | null | undefined) {
  return parseDiagramScale(scale) ?? diagramScaleDefaultPercent;
}

function getScaledSize(value: number, scalePercent: number) {
  return (value * scalePercent) / diagramScaleDefaultPercent;
}

function sanitizeSvgId(value: string | null | undefined, fallback: string) {
  const sanitized = (value?.trim() || fallback).replace(/[^a-zA-Z0-9_-]/g, "-");

  if (/^[a-zA-Z]/.test(sanitized)) {
    return sanitized;
  }

  return `diagram-${sanitized}`;
}

function createSvgTag(
  className: string,
  viewBox: string,
  width: number,
  height: number,
  scalePercent: number,
  accessibleTitle: string,
  children: string,
) {
  return `<svg role="img" viewBox="${escapeHtml(viewBox)}" class="${className}" preserveAspectRatio="xMidYMid meet" width="${formatNumber(
    getScaledSize(width, scalePercent),
  )}" height="${formatNumber(getScaledSize(height, scalePercent))}" xmlns="http://www.w3.org/2000/svg">
  <title>${escapeHtml(accessibleTitle)}</title>
  ${children}
</svg>`;
}

function getDiagramLabelCharacterLimit(nodeCount: number) {
  if (nodeCount <= 3) {
    return 30;
  }

  if (nodeCount <= 5) {
    return 26;
  }

  return 22;
}

function getDiagramMaxNodeWidth(nodeCount: number) {
  if (nodeCount <= 3) {
    return 236;
  }

  if (nodeCount <= 5) {
    return 216;
  }

  return 192;
}

function getDiagramNodeWidth(labels: string[], nodeCount: number) {
  const longestLabelLength = Math.max(...labels.map((label) => Array.from(label).length), 1);

  return clamp(
    longestLabelLength * diagramEstimatedCharacterWidth + diagramNodeHorizontalPadding,
    diagramMinNodeWidth,
    getDiagramMaxNodeWidth(nodeCount),
  );
}

function renderDiagramSvg(diagram: ParsedDiagram, idBase: string, scalePercent: number) {
  const markerId = `${idBase}-arrow`;
  const maxLabelCharacters = getDiagramLabelCharacterLimit(diagram.nodes.length);
  const displayNodes = diagram.nodes.map((node) => ({
    ...node,
    displayLabel: truncateLabel(node.label, maxLabelCharacters),
  }));
  const nodeWidth = getDiagramNodeWidth(
    displayNodes.map((node) => node.displayLabel),
    diagram.nodes.length,
  );
  const svgHeight = diagramNodeHeight + diagramVerticalPadding * 2;
  const svgWidth =
    diagramHorizontalPadding * 2 + diagram.nodes.length * nodeWidth + Math.max(0, diagram.nodes.length - 1) * diagramNodeGap;
  const centerY = svgHeight / 2;
  const positionedNodes = displayNodes.map((node, index) => ({
    ...node,
    x: diagramHorizontalPadding + nodeWidth / 2 + index * (nodeWidth + diagramNodeGap),
    y: centerY,
  }));
  const positionedNodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const positionedEdges = diagram.edges.flatMap((edge) => {
    const source = positionedNodeById.get(edge.sourceId);
    const target = positionedNodeById.get(edge.targetId);
    if (!source || !target || source.id === target.id) {
      return [];
    }

    const direction = target.x >= source.x ? 1 : -1;
    const startX = source.x + direction * (nodeWidth / 2 + diagramArrowInset);
    const endX = target.x - direction * (nodeWidth / 2 + diagramArrowInset);

    return [{ ...edge, startX, startY: source.y, endX, endY: target.y }];
  });
  const accessibleTitle = `Diagrama com ${diagram.nodes.length} nos e ${diagram.edges.length} conexoes`;
  const edges = positionedEdges
    .map(
      (edge) =>
        `<line class="notebook-diagram-visual-edge" x1="${formatNumber(edge.startX)}" y1="${formatNumber(
          edge.startY,
        )}" x2="${formatNumber(edge.endX)}" y2="${formatNumber(edge.endY)}" marker-end="url(#${escapeHtml(markerId)})" />`,
    )
    .join("\n");
  const nodes = positionedNodes
    .map(
      (node) => `<g>
  <title>${escapeHtml(node.label)}</title>
  <rect class="notebook-diagram-visual-node" x="${formatNumber(node.x - nodeWidth / 2)}" y="${formatNumber(
    node.y - diagramNodeHeight / 2,
  )}" width="${formatNumber(nodeWidth)}" height="${formatNumber(diagramNodeHeight)}" rx="8" />
  <text class="notebook-diagram-visual-label" x="${formatNumber(node.x)}" y="${formatNumber(
    node.y,
  )}" dominant-baseline="middle" text-anchor="middle">${escapeHtml(node.displayLabel)}</text>
</g>`,
    )
    .join("\n");

  return createSvgTag(
    "notebook-diagram-visual",
    `0 0 ${formatNumber(svgWidth)} ${formatNumber(svgHeight)}`,
    svgWidth,
    svgHeight,
    scalePercent,
    accessibleTitle,
    `<defs>
  <marker id="${escapeHtml(markerId)}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
    <path class="notebook-diagram-visual-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
  </marker>
</defs>
<g>${edges}</g>
<g>${nodes}</g>`,
  );
}

function getGraphColumnCount(nodeCount: number) {
  if (nodeCount <= 2) {
    return Math.max(nodeCount, 1);
  }

  if (nodeCount <= 4) {
    return 2;
  }

  return 3;
}

function getGraphLabelCharacterLimit(nodeCount: number) {
  if (nodeCount <= 4) {
    return 30;
  }

  if (nodeCount <= 8) {
    return 24;
  }

  return 20;
}

function getGraphMaxNodeWidth(nodeCount: number) {
  if (nodeCount <= 4) {
    return 212;
  }

  if (nodeCount <= 8) {
    return 188;
  }

  return 168;
}

function getGraphNodeWidth(labels: string[], nodeCount: number) {
  const longestLabelLength = Math.max(...labels.map((label) => Array.from(label).length), 1);

  return clamp(
    longestLabelLength * graphEstimatedCharacterWidth + graphNodeHorizontalPadding,
    graphMinNodeWidth,
    getGraphMaxNodeWidth(nodeCount),
  );
}

function getGraphNodeBoundaryDistance(unitX: number, unitY: number, nodeWidth: number) {
  const horizontalDistance = unitX === 0 ? Number.POSITIVE_INFINITY : nodeWidth / 2 / Math.abs(unitX);
  const verticalDistance = unitY === 0 ? Number.POSITIVE_INFINITY : graphNodeHeight / 2 / Math.abs(unitY);

  return Math.min(horizontalDistance, verticalDistance);
}

function renderGridGraphSvg(graph: ParsedGraph, idBase: string, scalePercent: number) {
  const markerId = `${idBase}-arrow`;
  const columnCount = getGraphColumnCount(graph.nodes.length);
  const rowCount = Math.max(1, Math.ceil(graph.nodes.length / columnCount));
  const maxLabelCharacters = getGraphLabelCharacterLimit(graph.nodes.length);
  const displayNodes = graph.nodes.map((node) => ({
    ...node,
    displayLabel: truncateLabel(node.label, maxLabelCharacters),
  }));
  const nodeWidth = getGraphNodeWidth(
    displayNodes.map((node) => node.displayLabel),
    graph.nodes.length,
  );
  const contentWidth = columnCount * nodeWidth + Math.max(0, columnCount - 1) * graphColumnGap;
  const svgWidth = graphHorizontalPadding * 2 + contentWidth;
  const svgHeight = graphVerticalPadding * 2 + rowCount * graphNodeHeight + Math.max(0, rowCount - 1) * graphRowGap;
  const positionedNodes = displayNodes.map((node, index) => {
    const rowIndex = Math.floor(index / columnCount);
    const columnIndex = index % columnCount;
    const rowStartIndex = rowIndex * columnCount;
    const nodesInRow = Math.min(columnCount, graph.nodes.length - rowStartIndex);
    const rowWidth = nodesInRow * nodeWidth + Math.max(0, nodesInRow - 1) * graphColumnGap;
    const rowLeft = graphHorizontalPadding + (contentWidth - rowWidth) / 2;

    return {
      ...node,
      x: rowLeft + nodeWidth / 2 + columnIndex * (nodeWidth + graphColumnGap),
      y: graphVerticalPadding + graphNodeHeight / 2 + rowIndex * (graphNodeHeight + graphRowGap),
    };
  });
  const positionedNodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const positionedEdges = graph.edges.flatMap((edge) => {
    const source = positionedNodeById.get(edge.sourceId);
    const target = positionedNodeById.get(edge.targetId);
    if (!source || !target || source.id === target.id) {
      return [];
    }

    const deltaX = target.x - source.x;
    const deltaY = target.y - source.y;
    const distance = Math.hypot(deltaX, deltaY);
    if (distance === 0) {
      return [];
    }

    const unitX = deltaX / distance;
    const unitY = deltaY / distance;
    const sourceDistance = getGraphNodeBoundaryDistance(unitX, unitY, nodeWidth) + graphArrowInset;
    const targetDistance = getGraphNodeBoundaryDistance(unitX, unitY, nodeWidth) + graphArrowInset;

    return [
      {
        ...edge,
        startX: source.x + unitX * sourceDistance,
        startY: source.y + unitY * sourceDistance,
        endX: target.x - unitX * targetDistance,
        endY: target.y - unitY * targetDistance,
      },
    ];
  });
  const accessibleTitle = `Grafo com ${graph.nodes.length} nos e ${graph.edges.length} conexoes`;
  const edges = positionedEdges
    .map((edge) => {
      const marker = edge.direction === "directed" ? ` marker-end="url(#${escapeHtml(markerId)})"` : "";

      return `<line class="notebook-diagram-visual-edge" x1="${formatNumber(edge.startX)}" y1="${formatNumber(
        edge.startY,
      )}" x2="${formatNumber(edge.endX)}" y2="${formatNumber(edge.endY)}"${marker} />`;
    })
    .join("\n");
  const nodes = positionedNodes
    .map(
      (node) => `<g>
  <title>${escapeHtml(node.label)}</title>
  <rect class="notebook-diagram-visual-node" x="${formatNumber(node.x - nodeWidth / 2)}" y="${formatNumber(
    node.y - graphNodeHeight / 2,
  )}" width="${formatNumber(nodeWidth)}" height="${formatNumber(graphNodeHeight)}" rx="8" />
  <text class="notebook-diagram-visual-label" x="${formatNumber(node.x)}" y="${formatNumber(
    node.y,
  )}" dominant-baseline="middle" text-anchor="middle">${escapeHtml(node.displayLabel)}</text>
</g>`,
    )
    .join("\n");

  return createSvgTag(
    "notebook-graph-visual",
    `0 0 ${formatNumber(svgWidth)} ${formatNumber(svgHeight)}`,
    svgWidth,
    svgHeight,
    scalePercent,
    accessibleTitle,
    `<defs>
  <marker id="${escapeHtml(markerId)}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
    <path class="notebook-diagram-visual-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
  </marker>
</defs>
<g>${edges}</g>
<g>${nodes}</g>`,
  );
}

type CycleLabelAnchor = "start" | "middle" | "end";

function getCycleLabelAnchor(unitX: number): CycleLabelAnchor {
  if (unitX > 0.35) {
    return "start";
  }

  if (unitX < -0.35) {
    return "end";
  }

  return "middle";
}

function getCycleLabelHorizontalExtent(labelX: number, labelWidth: number, anchor: CycleLabelAnchor) {
  if (anchor === "start") {
    return [labelX, labelX + labelWidth] as const;
  }

  if (anchor === "end") {
    return [labelX - labelWidth, labelX] as const;
  }

  return [labelX - labelWidth / 2, labelX + labelWidth / 2] as const;
}

function renderCycleGraphSvg(graph: ParsedGraph, cycle: SimpleCycle, scalePercent: number) {
  const vertexCount = cycle.vertexIds.length;
  const labelById = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const radius = clamp(cycleMinChordLength / (2 * Math.sin(Math.PI / vertexCount)), 64, 168);
  const labelDistance = radius + cycleVertexRadius + cycleLabelGap;
  const vertices = cycle.vertexIds.map((vertexId, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / vertexCount;
    const unitX = Math.cos(angle);
    const unitY = Math.sin(angle);
    const label = labelById.get(vertexId) ?? vertexId;
    const displayLabel = truncateLabel(label, cycleLabelCharacterLimit);
    const anchor = getCycleLabelAnchor(unitX);
    const extraDistance = anchor === "middle" ? 4 : 0;

    return {
      id: vertexId,
      label,
      displayLabel,
      x: radius * unitX,
      y: radius * unitY,
      labelX: (labelDistance + extraDistance) * unitX,
      labelY: (labelDistance + extraDistance) * unitY,
      anchor,
    };
  });

  let minX = -radius - cycleVertexRadius;
  let maxX = radius + cycleVertexRadius;
  let minY = -radius - cycleVertexRadius;
  let maxY = radius + cycleVertexRadius;
  vertices.forEach((vertex) => {
    const labelWidth = Array.from(vertex.displayLabel).length * graphEstimatedCharacterWidth;
    const [labelMinX, labelMaxX] = getCycleLabelHorizontalExtent(vertex.labelX, labelWidth, vertex.anchor);
    minX = Math.min(minX, labelMinX);
    maxX = Math.max(maxX, labelMaxX);
    minY = Math.min(minY, vertex.labelY - cycleLabelHalfHeight);
    maxY = Math.max(maxY, vertex.labelY + cycleLabelHalfHeight);
  });

  const svgWidth = maxX - minX + cyclePadding * 2;
  const svgHeight = maxY - minY + cyclePadding * 2;
  const viewBox = `${formatNumber(minX - cyclePadding)} ${formatNumber(minY - cyclePadding)} ${formatNumber(
    svgWidth,
  )} ${formatNumber(svgHeight)}`;
  const accessibleTitle = `Grafo ciclo com ${vertexCount} vertices e ${vertexCount} arestas`;
  const edges = vertices
    .map((vertex, index) => {
      const nextVertex = vertices[(index + 1) % vertexCount];

      return `<line class="notebook-diagram-visual-edge" x1="${formatNumber(vertex.x)}" y1="${formatNumber(
        vertex.y,
      )}" x2="${formatNumber(nextVertex.x)}" y2="${formatNumber(nextVertex.y)}" />`;
    })
    .join("\n");
  const nodes = vertices
    .map(
      (vertex) => `<g>
  <title>${escapeHtml(vertex.label)}</title>
  <circle class="notebook-graph-cycle-vertex" cx="${formatNumber(vertex.x)}" cy="${formatNumber(vertex.y)}" r="${cycleVertexRadius}" />
  <text class="notebook-diagram-visual-label notebook-graph-cycle-vertex-label" x="${formatNumber(
    vertex.labelX,
  )}" y="${formatNumber(vertex.labelY)}" dominant-baseline="middle" text-anchor="${vertex.anchor}">${escapeHtml(
    vertex.displayLabel,
  )}</text>
</g>`,
    )
    .join("\n");

  return createSvgTag(
    "notebook-graph-visual notebook-graph-visual--cycle",
    viewBox,
    svgWidth,
    svgHeight,
    scalePercent,
    accessibleTitle,
    `<g>${edges}</g>
<g>${nodes}</g>`,
  );
}

function renderGraphSvg(graph: ParsedGraph, idBase: string, scalePercent: number) {
  const cycle = detectSimpleCycle(graph);

  if (cycle) {
    return renderCycleGraphSvg(graph, cycle, scalePercent);
  }

  return renderGridGraphSvg(graph, idBase, scalePercent);
}

function getFlowchartNodeWidth(labels: string[]) {
  const longestLabelLength = Math.max(...labels.map((label) => Array.from(label).length), 1);

  return clamp(
    longestLabelLength * flowchartEstimatedCharacterWidth + flowchartNodeHorizontalPadding,
    flowchartMinNodeWidth,
    flowchartMaxNodeWidth,
  );
}

function isTerminalLabel(label: string) {
  const normalizedLabel = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  return normalizedLabel === "inicio" || normalizedLabel === "fim" || normalizedLabel === "start" || normalizedLabel === "end";
}

function renderFlowchartSvg(flowchart: ParsedDiagram, idBase: string, scalePercent: number) {
  const markerId = `${idBase}-arrow`;
  const displayNodes = flowchart.nodes.map((node) => ({
    ...node,
    displayLabel: truncateLabel(node.label, flowchartMaxLabelCharacters),
  }));
  const nodeWidth = getFlowchartNodeWidth(displayNodes.map((node) => node.displayLabel));
  const svgWidth = nodeWidth + flowchartHorizontalPadding * 2;
  const svgHeight =
    flowchartVerticalPadding * 2 +
    flowchart.nodes.length * flowchartNodeHeight +
    Math.max(0, flowchart.nodes.length - 1) * flowchartNodeGap;
  const centerX = svgWidth / 2;
  const positionedNodes = displayNodes.map((node, index) => ({
    ...node,
    x: centerX,
    y: flowchartVerticalPadding + flowchartNodeHeight / 2 + index * (flowchartNodeHeight + flowchartNodeGap),
  }));
  const nodeIndexById = new Map(positionedNodes.map((node, index) => [node.id, index]));
  const positionedNodeById = new Map(positionedNodes.map((node) => [node.id, node]));
  const positionedEdges = flowchart.edges.flatMap((edge) => {
    const source = positionedNodeById.get(edge.sourceId);
    const target = positionedNodeById.get(edge.targetId);
    const sourceIndex = nodeIndexById.get(edge.sourceId);
    const targetIndex = nodeIndexById.get(edge.targetId);

    if (!source || !target || sourceIndex === undefined || targetIndex === undefined || source.id === target.id) {
      return [];
    }

    const direction = target.y >= source.y ? 1 : -1;
    const startY = source.y + direction * (flowchartNodeHeight / 2 + flowchartArrowInset);
    const endY = target.y - direction * (flowchartNodeHeight / 2 + flowchartArrowInset);
    const isAdjacent = Math.abs(targetIndex - sourceIndex) === 1;

    if (isAdjacent) {
      return [{ ...edge, path: `M ${formatNumber(source.x)} ${formatNumber(startY)} L ${formatNumber(target.x)} ${formatNumber(endY)}` }];
    }

    const sideX = centerX + nodeWidth / 2 + flowchartSideLaneOffset;
    const midStartY = startY + direction * flowchartSideLaneBendOffset;
    const midEndY = endY - direction * flowchartSideLaneBendOffset;

    return [
      {
        ...edge,
        path: `M ${formatNumber(source.x)} ${formatNumber(startY)} L ${formatNumber(source.x)} ${formatNumber(
          midStartY,
        )} L ${formatNumber(sideX)} ${formatNumber(midStartY)} L ${formatNumber(sideX)} ${formatNumber(
          midEndY,
        )} L ${formatNumber(target.x)} ${formatNumber(midEndY)} L ${formatNumber(target.x)} ${formatNumber(endY)}`,
      },
    ];
  });
  const accessibleTitle = `Fluxograma com ${flowchart.nodes.length} etapas e ${flowchart.edges.length} conexoes`;
  const edges = positionedEdges
    .map((edge) => `<path class="notebook-flowchart-visual-edge" d="${edge.path}" marker-end="url(#${escapeHtml(markerId)})" />`)
    .join("\n");
  const nodes = positionedNodes
    .map((node) => {
      const terminal = isTerminalLabel(node.label);
      const className = terminal
        ? "notebook-flowchart-visual-node notebook-flowchart-visual-node--terminal"
        : "notebook-flowchart-visual-node";

      return `<g>
  <title>${escapeHtml(node.label)}</title>
  <rect class="${className}" x="${formatNumber(node.x - nodeWidth / 2)}" y="${formatNumber(
    node.y - flowchartNodeHeight / 2,
  )}" width="${formatNumber(nodeWidth)}" height="${formatNumber(flowchartNodeHeight)}" rx="${terminal ? "18" : "8"}" />
  <text class="notebook-flowchart-visual-label" x="${formatNumber(node.x)}" y="${formatNumber(
    node.y,
  )}" dominant-baseline="middle" text-anchor="middle">${escapeHtml(node.displayLabel)}</text>
</g>`;
    })
    .join("\n");

  return createSvgTag(
    "notebook-flowchart-visual",
    `0 0 ${formatNumber(svgWidth)} ${formatNumber(svgHeight)}`,
    svgWidth,
    svgHeight,
    scalePercent,
    accessibleTitle,
    `<defs>
  <marker id="${escapeHtml(markerId)}" markerWidth="10" markerHeight="10" refX="9" refY="5" orient="auto" markerUnits="strokeWidth">
    <path class="notebook-flowchart-visual-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
  </marker>
</defs>
<g>${edges}</g>
<g>${nodes}</g>`,
  );
}

function getFallbackMessage(kind: DiagramKind, source: string) {
  if (source.trim().length === 0) {
    if (kind === "graph") {
      return "Descreva vertices e conexoes.";
    }

    if (kind === "flowchart") {
      return "Descreva as etapas do fluxo.";
    }

    return "Descreva relacoes no formato: Entrada -> Processamento.";
  }

  if (kind === "graph") {
    return "Nenhuma conexao valida encontrada. Use A -> B ou A -- B.";
  }

  return "Nenhuma relacao valida encontrada. Use o formato: A -> B.";
}

function renderFallbackHtml(kind: DiagramKind, source: string) {
  const sourceHtml =
    source.trim().length > 0 ? `<pre class="athenaeum-export__diagram-source">${escapeHtml(source)}</pre>` : "";

  return `<div class="athenaeum-export__diagram-fallback" role="note">
  <strong>${escapeHtml(diagramKindLabels[kind])}</strong>
  <span>${escapeHtml(getFallbackMessage(kind, source))}</span>
  ${sourceHtml}
</div>`;
}

function wrapRenderedSvg(kind: DiagramKind, svg: string) {
  return `<div class="athenaeum-export__diagram-visual" aria-label="${escapeHtml(diagramKindLabels[kind])}">
  ${svg}
</div>`;
}

// Grafo com detalhes: desenho e conjuntos (identificação, V e E) como irmãos
// dentro de um layout flexível. O texto fica fora do SVG (selecionável,
// pesquisável e copiável) e o CSS de exportação os coloca lado a lado quando há
// espaço, empilhando quando não há.
function wrapGraphWithDetails(svg: string, detailsHtml: string) {
  return `<div class="athenaeum-export__graph-layout">
  <div class="athenaeum-export__graph-visual">
  ${svg}
</div>
  ${detailsHtml}
</div>`;
}

export function renderNotebookDiagramStaticSvg(
  input: RenderNotebookDiagramStaticSvgInput,
): NotebookDiagramStaticSvgRenderResult {
  const rawKind = input.kind ?? undefined;
  const kind: DiagramKind = isDiagramKind(rawKind) ? rawKind : "diagram";
  const source = input.source.trim();
  const scalePercent = getScalePercent(input.scale);
  const idBase = sanitizeSvgId(input.idPrefix, `athenaeum-export-${kind}`);

  if (kind === "graph") {
    const graph = parseGraphSource(source);

    if (graph.edges.length === 0) {
      return {
        kind,
        status: "fallback",
        html: renderFallbackHtml(kind, source),
        source,
        scalePercent,
        hasGraphDetails: false,
      };
    }

    // O SVG do grafo é gerado em tamanho natural (escala 100): a escala
    // persistida controla a figura inteira via largura no HTML exportado, sem
    // transform: scale() e sem overflow. Assim o desenho ocupa a coluna
    // disponível e os detalhes permanecem legíveis.
    const svg = renderGraphSvg(graph, idBase, diagramScaleDefaultPercent);
    const detailsModel = buildGraphDetailsModel(graph);
    const html = detailsModel
      ? wrapGraphWithDetails(svg, renderGraphDetailsHtml(detailsModel))
      : wrapRenderedSvg(kind, svg);

    return {
      kind,
      status: "rendered",
      html,
      source,
      scalePercent,
      hasGraphDetails: detailsModel !== null,
    };
  }

  const parsedDiagram = parseDiagramSource(source);

  if (parsedDiagram.edges.length === 0) {
    return {
      kind,
      status: "fallback",
      html: renderFallbackHtml(kind, source),
      source,
      scalePercent,
      hasGraphDetails: false,
    };
  }

  return {
    kind,
    status: "rendered",
    html: wrapRenderedSvg(
      kind,
      kind === "flowchart"
        ? renderFlowchartSvg(parsedDiagram, idBase, scalePercent)
        : renderDiagramSvg(parsedDiagram, idBase, scalePercent),
    ),
    source,
    scalePercent,
    hasGraphDetails: false,
  };
}
