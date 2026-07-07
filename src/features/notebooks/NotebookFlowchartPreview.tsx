import { type CSSProperties, useId } from "react";

import { NotebookDiagramFrame } from "./NotebookDiagramFrame";
import type { ParsedDiagram } from "./notebookDiagramParser";

type NotebookFlowchartPreviewProps = {
  flowchart: ParsedDiagram;
};

type FlowchartVisualStyle = CSSProperties & {
  "--notebook-flowchart-visual-height": string;
};

const minNodeWidth = 176;
const maxNodeWidth = 280;
const nodeHeight = 42;
const nodeGap = 24;
const horizontalPadding = 42;
const verticalPadding = 18;
const maxLabelCharacters = 34;
const estimatedCharacterWidth = 7.1;
const nodeHorizontalPadding = 40;
const arrowInset = 5;
const sideLaneOffset = 22;
const sideLaneBendOffset = 12;
const maxVisualHeight = 384;

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

function isTerminalLabel(label: string) {
  const normalizedLabel = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  return (
    normalizedLabel === "inicio" ||
    normalizedLabel === "fim" ||
    normalizedLabel === "start" ||
    normalizedLabel === "end"
  );
}

export function NotebookFlowchartPreview({ flowchart }: NotebookFlowchartPreviewProps) {
  const arrowMarkerId = `notebook-flowchart-arrow-${useId().replace(/:/g, "")}`;
  const displayNodes = flowchart.nodes.map((node) => ({
    ...node,
    displayLabel: truncateLabel(node.label),
  }));
  const nodeWidth = getNodeWidth(displayNodes.map((node) => node.displayLabel));
  const svgWidth = nodeWidth + horizontalPadding * 2;
  const svgHeight =
    verticalPadding * 2 + flowchart.nodes.length * nodeHeight + Math.max(0, flowchart.nodes.length - 1) * nodeGap;
  const centerX = svgWidth / 2;
  const positionedNodes = displayNodes.map((node, index) => ({
    ...node,
    x: centerX,
    y: verticalPadding + nodeHeight / 2 + index * (nodeHeight + nodeGap),
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
    const startY = source.y + direction * (nodeHeight / 2 + arrowInset);
    const endY = target.y - direction * (nodeHeight / 2 + arrowInset);
    const isAdjacent = Math.abs(targetIndex - sourceIndex) === 1;

    if (isAdjacent) {
      return [
        {
          ...edge,
          path: `M ${source.x} ${startY} L ${target.x} ${endY}`,
        },
      ];
    }

    const sideX = centerX + nodeWidth / 2 + sideLaneOffset;
    const midStartY = startY + direction * sideLaneBendOffset;
    const midEndY = endY - direction * sideLaneBendOffset;

    return [
      {
        ...edge,
        path: `M ${source.x} ${startY} L ${source.x} ${midStartY} L ${sideX} ${midStartY} L ${sideX} ${midEndY} L ${target.x} ${midEndY} L ${target.x} ${endY}`,
      },
    ];
  });
  const visualStyle: FlowchartVisualStyle = {
    "--notebook-flowchart-visual-height": `${Math.min(svgHeight, maxVisualHeight)}px`,
  };

  return (
    <NotebookDiagramFrame>
      <div
        className="notebook-flowchart-visual-host"
        aria-label={`Fluxograma com ${flowchart.nodes.length} etapas e ${flowchart.edges.length} conexoes`}
      >
      <svg
        role="img"
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="notebook-flowchart-visual"
        style={visualStyle}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{`Fluxograma com ${flowchart.nodes.length} etapas e ${flowchart.edges.length} conexoes`}</title>
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
            <path className="notebook-flowchart-visual-arrowhead" d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        </defs>
        <g>
          {positionedEdges.map((edge) => (
            <path
              key={edge.id}
              className="notebook-flowchart-visual-edge"
              d={edge.path}
              markerEnd={`url(#${arrowMarkerId})`}
            />
          ))}
        </g>
        <g>
          {positionedNodes.map((node) => (
            <g key={node.id}>
              <title>{node.label}</title>
              <rect
                className={
                  isTerminalLabel(node.label)
                    ? "notebook-flowchart-visual-node notebook-flowchart-visual-node--terminal"
                    : "notebook-flowchart-visual-node"
                }
                x={node.x - nodeWidth / 2}
                y={node.y - nodeHeight / 2}
                width={nodeWidth}
                height={nodeHeight}
                rx={isTerminalLabel(node.label) ? "18" : "8"}
              />
              <text
                className="notebook-flowchart-visual-label"
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
    </NotebookDiagramFrame>
  );
}
