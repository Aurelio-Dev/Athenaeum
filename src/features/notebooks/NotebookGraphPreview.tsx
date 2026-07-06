import { type CSSProperties, useId } from "react";

import type { ParsedDiagram } from "./notebookDiagramParser";

type NotebookGraphPreviewProps = {
  graph: ParsedDiagram;
};

type GraphVisualStyle = CSSProperties & {
  "--notebook-graph-visual-height": string;
};

const minNodeWidth = 136;
const nodeHeight = 42;
const columnGap = 44;
const rowGap = 42;
const horizontalPadding = 28;
const verticalPadding = 20;
const estimatedCharacterWidth = 7.1;
const nodeHorizontalPadding = 38;
const arrowInset = 5;
const maxVisualHeight = 320;

function getColumnCount(nodeCount: number) {
  if (nodeCount <= 2) {
    return Math.max(nodeCount, 1);
  }

  if (nodeCount <= 4) {
    return 2;
  }

  return 3;
}

function getLabelCharacterLimit(nodeCount: number) {
  if (nodeCount <= 4) {
    return 30;
  }

  if (nodeCount <= 8) {
    return 24;
  }

  return 20;
}

function getMaxNodeWidth(nodeCount: number) {
  if (nodeCount <= 4) {
    return 212;
  }

  if (nodeCount <= 8) {
    return 188;
  }

  return 168;
}

function truncateLabel(label: string, maxLabelCharacters: number) {
  const normalizedLabel = label.replace(/\s+/g, " ").trim();
  const labelCharacters = Array.from(normalizedLabel);

  if (labelCharacters.length <= maxLabelCharacters) {
    return normalizedLabel;
  }

  return `${labelCharacters.slice(0, maxLabelCharacters - 3).join("")}...`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getNodeWidth(labels: string[], nodeCount: number) {
  const longestLabelLength = Math.max(...labels.map((label) => Array.from(label).length), 1);

  return clamp(
    longestLabelLength * estimatedCharacterWidth + nodeHorizontalPadding,
    minNodeWidth,
    getMaxNodeWidth(nodeCount),
  );
}

function getNodeBoundaryDistance(unitX: number, unitY: number, nodeWidth: number) {
  const horizontalDistance = unitX === 0 ? Number.POSITIVE_INFINITY : nodeWidth / 2 / Math.abs(unitX);
  const verticalDistance = unitY === 0 ? Number.POSITIVE_INFINITY : nodeHeight / 2 / Math.abs(unitY);

  return Math.min(horizontalDistance, verticalDistance);
}

export function NotebookGraphPreview({ graph }: NotebookGraphPreviewProps) {
  const arrowMarkerId = `notebook-graph-arrow-${useId().replace(/:/g, "")}`;
  const columnCount = getColumnCount(graph.nodes.length);
  const rowCount = Math.max(1, Math.ceil(graph.nodes.length / columnCount));
  const maxLabelCharacters = getLabelCharacterLimit(graph.nodes.length);
  const displayNodes = graph.nodes.map((node) => ({
    ...node,
    displayLabel: truncateLabel(node.label, maxLabelCharacters),
  }));
  const nodeWidth = getNodeWidth(
    displayNodes.map((node) => node.displayLabel),
    graph.nodes.length,
  );
  const contentWidth = columnCount * nodeWidth + Math.max(0, columnCount - 1) * columnGap;
  const svgWidth = horizontalPadding * 2 + contentWidth;
  const svgHeight = verticalPadding * 2 + rowCount * nodeHeight + Math.max(0, rowCount - 1) * rowGap;
  const positionedNodes = displayNodes.map((node, index) => {
    const rowIndex = Math.floor(index / columnCount);
    const columnIndex = index % columnCount;
    const rowStartIndex = rowIndex * columnCount;
    const nodesInRow = Math.min(columnCount, graph.nodes.length - rowStartIndex);
    const rowWidth = nodesInRow * nodeWidth + Math.max(0, nodesInRow - 1) * columnGap;
    const rowLeft = horizontalPadding + (contentWidth - rowWidth) / 2;

    return {
      ...node,
      x: rowLeft + nodeWidth / 2 + columnIndex * (nodeWidth + columnGap),
      y: verticalPadding + nodeHeight / 2 + rowIndex * (nodeHeight + rowGap),
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
    const sourceDistance = getNodeBoundaryDistance(unitX, unitY, nodeWidth) + arrowInset;
    const targetDistance = getNodeBoundaryDistance(unitX, unitY, nodeWidth) + arrowInset;

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
  const visualStyle: GraphVisualStyle = {
    "--notebook-graph-visual-height": `${Math.min(svgHeight, maxVisualHeight)}px`,
  };

  return (
    <div
      className="notebook-graph-visual-host"
      aria-label={`Grafo com ${graph.nodes.length} nos e ${graph.edges.length} conexoes`}
    >
      <svg
        role="img"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="notebook-graph-visual"
        style={visualStyle}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{`Grafo com ${graph.nodes.length} nos e ${graph.edges.length} conexoes`}</title>
        <defs>
          <marker
            id={arrowMarkerId}
            markerWidth="10"
            markerHeight="10"
            refX="9"
            refY="5"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path className="notebook-diagram-visual-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g>
          {positionedEdges.map((edge) => (
            <line
              key={edge.id}
              className="notebook-diagram-visual-edge"
              x1={edge.startX}
              y1={edge.startY}
              x2={edge.endX}
              y2={edge.endY}
              markerEnd={`url(#${arrowMarkerId})`}
            />
          ))}
        </g>
        <g>
          {positionedNodes.map((node) => (
            <g key={node.id}>
              <title>{node.label}</title>
              <rect
                className="notebook-diagram-visual-node"
                x={node.x - nodeWidth / 2}
                y={node.y - nodeHeight / 2}
                width={nodeWidth}
                height={nodeHeight}
                rx="8"
              />
              <text
                className="notebook-diagram-visual-label"
                x={node.x}
                y={node.y}
                dominantBaseline="middle"
                textAnchor="middle"
              >
                {node.displayLabel}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
