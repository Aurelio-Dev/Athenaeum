import { useId } from "react";

import type { ParsedDiagram } from "./notebookDiagramParser";

type NotebookDiagramPreviewProps = {
  diagram: ParsedDiagram;
};

const minNodeWidth = 132;
const maxNodeWidth = 176;
const nodeHeight = 44;
const nodeGap = 56;
const horizontalPadding = 24;
const verticalPadding = 18;
const maxLabelCharacters = 20;
const estimatedCharacterWidth = 7.2;
const nodeHorizontalPadding = 32;
const arrowInset = 5;

function truncateLabel(label: string) {
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

function getNodeWidth(labels: string[]) {
  const longestLabelLength = Math.max(...labels.map((label) => Array.from(label).length), 1);
  return clamp(longestLabelLength * estimatedCharacterWidth + nodeHorizontalPadding, minNodeWidth, maxNodeWidth);
}

export function NotebookDiagramPreview({ diagram }: NotebookDiagramPreviewProps) {
  const arrowMarkerId = `notebook-diagram-arrow-${useId().replace(/:/g, "")}`;
  const displayNodes = diagram.nodes.map((node) => ({
    ...node,
    displayLabel: truncateLabel(node.label),
  }));
  const nodeWidth = getNodeWidth(displayNodes.map((node) => node.displayLabel));
  const svgHeight = nodeHeight + verticalPadding * 2;
  const svgWidth =
    horizontalPadding * 2 + diagram.nodes.length * nodeWidth + Math.max(0, diagram.nodes.length - 1) * nodeGap;
  const centerY = svgHeight / 2;
  const positionedNodes = displayNodes.map((node, index) => ({
    ...node,
    x: horizontalPadding + nodeWidth / 2 + index * (nodeWidth + nodeGap),
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
    const startX = source.x + direction * (nodeWidth / 2 + arrowInset);
    const endX = target.x - direction * (nodeWidth / 2 + arrowInset);

    return [
      {
        ...edge,
        startX,
        startY: source.y,
        endX,
        endY: target.y,
      },
    ];
  });

  return (
    <div
      className="notebook-diagram-visual-host"
      aria-label={`Diagrama com ${diagram.nodes.length} nos e ${diagram.edges.length} conexoes`}
    >
      <svg
        role="img"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="notebook-diagram-visual"
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{`Diagrama com ${diagram.nodes.length} nos e ${diagram.edges.length} conexoes`}</title>
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
            <g key={edge.id}>
              <line
                className="notebook-diagram-visual-edge"
                x1={edge.startX}
                y1={edge.startY}
                x2={edge.endX}
                y2={edge.endY}
                markerEnd={`url(#${arrowMarkerId})`}
              />
            </g>
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
