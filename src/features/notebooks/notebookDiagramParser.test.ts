import { describe, expect, it } from "vitest";

import { parseDiagramSource } from "./notebookDiagramParser";

describe("parseDiagramSource", () => {
  it("ignores empty text", () => {
    expect(parseDiagramSource("")).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("ignores empty lines", () => {
    expect(parseDiagramSource("\n\n   \n")).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("parses a single relation", () => {
    expect(parseDiagramSource("Entrada -> Saída")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Saída" },
      ],
      edges: [{ id: "edge-1", sourceId: "node-1", targetId: "node-2" }],
    });
  });

  it("parses multiple relations", () => {
    expect(parseDiagramSource("Entrada -> Processamento\nProcessamento -> Saída")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Processamento" },
        { id: "node-3", label: "Saída" },
      ],
      edges: [
        { id: "edge-1", sourceId: "node-1", targetId: "node-2" },
        { id: "edge-2", sourceId: "node-2", targetId: "node-3" },
      ],
    });
  });

  it("preserves unique nodes in first-seen order", () => {
    expect(parseDiagramSource("B -> C\nA -> B\nC -> A").nodes).toEqual([
      { id: "node-1", label: "B" },
      { id: "node-2", label: "C" },
      { id: "node-3", label: "A" },
    ]);
  });

  it("ignores invalid lines", () => {
    expect(parseDiagramSource("Entrada sem seta\nA -> B -> C\nTexto solto")).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("accepts mixed valid and invalid lines", () => {
    expect(parseDiagramSource("Inválida\nEntrada -> Processamento\nA -> B -> C\nProcessamento -> Saída")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Processamento" },
        { id: "node-3", label: "Saída" },
      ],
      edges: [
        { id: "edge-1", sourceId: "node-1", targetId: "node-2" },
        { id: "edge-2", sourceId: "node-2", targetId: "node-3" },
      ],
    });
  });

  it("preserves labels with accents and Unicode", () => {
    expect(parseDiagramSource("Início -> Revisão ✅")).toEqual({
      nodes: [
        { id: "node-1", label: "Início" },
        { id: "node-2", label: "Revisão ✅" },
      ],
      edges: [{ id: "edge-1", sourceId: "node-1", targetId: "node-2" }],
    });
  });

  it("avoids empty nodes in malformed relations", () => {
    expect(parseDiagramSource("-> Saída\nEntrada ->\n -> \nEntrada -> Saída")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Saída" },
      ],
      edges: [{ id: "edge-1", sourceId: "node-1", targetId: "node-2" }],
    });
  });
});
