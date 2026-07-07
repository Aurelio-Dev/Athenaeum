import { describe, expect, it } from "vitest";

import { parseGraphSource } from "./notebookDiagramParser";
import { detectSimpleCycle } from "./notebookGraphAnalysis";

function labelsOfCycle(source: string) {
  const graph = parseGraphSource(source);
  const cycle = detectSimpleCycle(graph);
  if (!cycle) {
    return null;
  }

  const labelById = new Map(graph.nodes.map((node) => [node.id, node.label]));
  return cycle.vertexIds.map((vertexId) => labelById.get(vertexId));
}

describe("detectSimpleCycle", () => {
  it("detects C3", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 1")).toEqual(["1", "2", "3"]);
  });

  it("detects C4", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 4\n4 -- 1")).toEqual(["1", "2", "3", "4"]);
  });

  it("detects C5", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 4\n4 -- 5\n5 -- 1")).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("returns the same order regardless of source line order", () => {
    expect(labelsOfCycle("4 -- 5\n2 -- 3\n5 -- 1\n3 -- 4\n1 -- 2")).toEqual(["1", "2", "3", "4", "5"]);
    expect(labelsOfCycle("5 -- 1\n4 -- 5\n3 -- 4\n2 -- 3\n2 -- 1")).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("orders numeric labels naturally", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 10\n10 -- 1")).toEqual(["1", "2", "10"]);
  });

  it("rejects graphs with fewer than 3 vertices", () => {
    expect(labelsOfCycle("A -- B")).toBeNull();
  });

  it("rejects an open path", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 4")).toBeNull();
  });

  it("rejects a disconnected graph", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 1\n4 -- 5\n5 -- 6\n6 -- 4")).toBeNull();
  });

  it("rejects a branched graph", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 1\n3 -- 4")).toBeNull();
  });

  it("rejects a graph with a self-loop", () => {
    // 3 vértices e 3 arestas, mas uma delas é self-loop.
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -- 3")).toBeNull();
  });

  it("rejects a mixed directed/undirected graph", () => {
    expect(labelsOfCycle("1 -- 2\n2 -- 3\n3 -> 1")).toBeNull();
  });

  it("rejects a fully directed cycle", () => {
    expect(labelsOfCycle("1 -> 2\n2 -> 3\n3 -> 1")).toBeNull();
  });
});
