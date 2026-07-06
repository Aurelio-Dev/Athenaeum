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
    expect(parseDiagramSource("Entrada -> Saida")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Saida" },
      ],
      edges: [{ id: "edge-1", sourceId: "node-1", targetId: "node-2" }],
    });
  });

  it("parses multiple relations", () => {
    expect(parseDiagramSource("Entrada -> Processamento\nProcessamento -> Saida")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Processamento" },
        { id: "node-3", label: "Saida" },
      ],
      edges: [
        { id: "edge-1", sourceId: "node-1", targetId: "node-2" },
        { id: "edge-2", sourceId: "node-2", targetId: "node-3" },
      ],
    });
  });

  it("parses a single-line relation chain", () => {
    expect(parseDiagramSource("Elemento A -> Elemento B -> Elemento C -> Elemento D")).toEqual({
      nodes: [
        { id: "node-1", label: "Elemento A" },
        { id: "node-2", label: "Elemento B" },
        { id: "node-3", label: "Elemento C" },
        { id: "node-4", label: "Elemento D" },
      ],
      edges: [
        { id: "edge-1", sourceId: "node-1", targetId: "node-2" },
        { id: "edge-2", sourceId: "node-2", targetId: "node-3" },
        { id: "edge-3", sourceId: "node-3", targetId: "node-4" },
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
    expect(parseDiagramSource("Entrada sem seta\nA -- B\nTexto solto")).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it("accepts mixed valid and invalid lines", () => {
    expect(parseDiagramSource("Invalida\nEntrada -> Processamento\nA -- B\nProcessamento -> Saida")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Processamento" },
        { id: "node-3", label: "Saida" },
      ],
      edges: [
        { id: "edge-1", sourceId: "node-1", targetId: "node-2" },
        { id: "edge-2", sourceId: "node-2", targetId: "node-3" },
      ],
    });
  });

  it("preserves labels with accents and Unicode", () => {
    expect(parseDiagramSource("In\u00edcio -> Revis\u00e3o \u2705")).toEqual({
      nodes: [
        { id: "node-1", label: "In\u00edcio" },
        { id: "node-2", label: "Revis\u00e3o \u2705" },
      ],
      edges: [{ id: "edge-1", sourceId: "node-1", targetId: "node-2" }],
    });
  });

  it("avoids empty nodes in malformed relations", () => {
    expect(parseDiagramSource("-> Saida\nEntrada ->\n -> \nEntrada -> Saida\nA -> -> B")).toEqual({
      nodes: [
        { id: "node-1", label: "Entrada" },
        { id: "node-2", label: "Saida" },
      ],
      edges: [{ id: "edge-1", sourceId: "node-1", targetId: "node-2" }],
    });
  });
});
