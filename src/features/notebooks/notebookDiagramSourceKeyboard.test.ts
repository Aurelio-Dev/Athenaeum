import { describe, expect, it } from "vitest";

import { resolveDiagramSourceEnterAction } from "./notebookDiagramSourceKeyboard";

const base = {
  key: "Enter",
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  hasDiagram: true,
  hasSourceCaret: true,
};

describe("resolveDiagramSourceEnterAction", () => {
  it("insere uma unica quebra com um unico Shift+Enter no campo fonte", () => {
    expect(resolveDiagramSourceEnterAction({ ...base, shiftKey: true })).toBe("insert-line-break");
  });

  it("nao exige uma segunda combinacao: repetir a mesma decisao continua sendo uma quebra", () => {
    const decision = { ...base, shiftKey: true };
    expect(resolveDiagramSourceEnterAction(decision)).toBe("insert-line-break");
    expect(resolveDiagramSourceEnterAction(decision)).toBe("insert-line-break");
  });

  it("Enter simples dentro do diagrama sai do bloco", () => {
    expect(resolveDiagramSourceEnterAction({ ...base, shiftKey: false })).toBe("exit-block");
  });

  it("Shift+Enter fora do campo fonte nao e interceptado", () => {
    expect(resolveDiagramSourceEnterAction({ ...base, shiftKey: true, hasSourceCaret: false })).toBe("ignore");
  });

  it("ignora quando o caret nao esta em um diagrama", () => {
    expect(resolveDiagramSourceEnterAction({ ...base, hasDiagram: false })).toBe("ignore");
    expect(resolveDiagramSourceEnterAction({ ...base, shiftKey: true, hasDiagram: false })).toBe("ignore");
  });

  it("nunca intercepta com Ctrl/Meta/Alt (preserva atalhos globais do editor)", () => {
    expect(resolveDiagramSourceEnterAction({ ...base, shiftKey: true, ctrlKey: true })).toBe("ignore");
    expect(resolveDiagramSourceEnterAction({ ...base, metaKey: true })).toBe("ignore");
    expect(resolveDiagramSourceEnterAction({ ...base, altKey: true })).toBe("ignore");
  });

  it("ignora teclas diferentes de Enter", () => {
    expect(resolveDiagramSourceEnterAction({ ...base, key: "a" })).toBe("ignore");
    expect(resolveDiagramSourceEnterAction({ ...base, key: "Tab", shiftKey: true })).toBe("ignore");
  });
});
