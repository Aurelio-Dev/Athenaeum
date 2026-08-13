// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { TAG_COLOR_TOKEN_NAMES, TAG_COLOR_TOKENS } from "../../lib/tagColors";
import {
  applyNotebookTextColor,
  normalizeNotebookTextColors,
  renderNotebookTextColorStyles,
} from "./notebookTextColors";

function selectContents(element: HTMLElement) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
  if (!selection) {
    throw new Error("Selection indisponivel no teste.");
  }
  return selection;
}

function installExecCommandMock() {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn((command: string, _showUi: boolean, value: string) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }

      const range = selection.getRangeAt(0);
      const span = document.createElement("span");
      if (command === "hiliteColor") {
        span.style.backgroundColor = value;
      } else {
        span.style.color = value;
      }
      range.surroundContents(span);
      range.selectNodeContents(span);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe("normalizeNotebookTextColors", () => {
  it("converte cores canonicas inline e combina realce e fonte no mesmo span", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<span data-athenaeum-highlight="amber">antes <span style="color: rgb(29, 78, 216)">colorido</span></span>';

    normalizeNotebookTextColors(editor);

    expect(editor.innerHTML).toBe(
      '<span data-athenaeum-highlight="amber">antes </span><span data-athenaeum-highlight="amber" data-athenaeum-color="blue">colorido</span>',
    );
    expect(editor.innerHTML).not.toContain("style=");
  });

  it("descarta enums e estilos arbitrarios com unwrap seguro", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<span data-athenaeum-highlight="magenta" style="color:#123456">texto</span>';

    normalizeNotebookTextColors(editor);

    expect(editor.innerHTML).toBe("texto");
  });

  it("usa transparent como remocao transitoria sem apagar a outra dimensao", () => {
    const editor = document.createElement("div");
    editor.innerHTML = '<span data-athenaeum-highlight="amber" data-athenaeum-color="blue">antes <span style="background-color:transparent">sem realce</span> depois</span>';

    normalizeNotebookTextColors(editor);

    expect(editor.innerHTML).toBe(
      '<span data-athenaeum-highlight="amber" data-athenaeum-color="blue">antes </span><span data-athenaeum-color="blue">sem realce</span><span data-athenaeum-highlight="amber" data-athenaeum-color="blue"> depois</span>',
    );
    expect(editor.querySelector("span:empty")).toBeNull();
  });
});

describe("applyNotebookTextColor", () => {
  it.each(TAG_COLOR_TOKEN_NAMES)("aplica realce %s como enum sem style residual", (token) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "texto";
    document.body.append(editor);

    const selection = selectContents(editor);
    expect(applyNotebookTextColor(editor, selection, "highlight", token)).not.toBeNull();

    expect(editor.innerHTML).toBe(`<span data-athenaeum-highlight="${token}">texto</span>`);
    expect(editor.innerHTML).not.toContain("style=");
  });

  it.each(TAG_COLOR_TOKEN_NAMES)("aplica cor de fonte %s como enum sem style residual", (token) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "texto";
    document.body.append(editor);

    const selection = selectContents(editor);
    expect(applyNotebookTextColor(editor, selection, "color", token)).not.toBeNull();

    expect(editor.innerHTML).toBe(`<span data-athenaeum-color="${token}">texto</span>`);
    expect(editor.innerHTML).not.toContain("style=");
  });

  it("mantem realce e cor independentes e remove cada um sem span vazio", () => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.textContent = "texto";
    document.body.append(editor);

    let selection = selectContents(editor);
    applyNotebookTextColor(editor, selection, "highlight", "amber");
    selection = window.getSelection() as Selection;
    applyNotebookTextColor(editor, selection, "color", "blue");
    expect(editor.innerHTML).toBe('<span data-athenaeum-highlight="amber" data-athenaeum-color="blue">texto</span>');

    selection = selectContents(editor);
    applyNotebookTextColor(editor, selection, "highlight", null);
    expect(editor.innerHTML).toBe('<span data-athenaeum-color="blue">texto</span>');

    selection = selectContents(editor);
    applyNotebookTextColor(editor, selection, "color", null);
    expect(editor.innerHTML).toBe("texto");
    expect(editor.querySelector("span")).toBeNull();
  });
});

describe("renderNotebookTextColorStyles", () => {
  it("resolve os nove tokens pelo mapa canonico e preserva fundos na impressao", () => {
    const styles = renderNotebookTextColorStyles(".escopo");

    TAG_COLOR_TOKEN_NAMES.forEach((token) => {
      expect(styles).toContain(`[data-athenaeum-highlight="${token}"]`);
      expect(styles).toContain(`background-color: ${TAG_COLOR_TOKENS[token].pastel}`);
      expect(styles).toContain(`[data-athenaeum-color="${token}"]`);
      expect(styles).toContain(`color: ${TAG_COLOR_TOKENS[token].bg}`);
    });
    expect(styles).toContain("-webkit-print-color-adjust: exact");
    expect(styles).toContain("print-color-adjust: exact");
  });
});
