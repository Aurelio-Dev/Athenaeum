// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { TAG_COLOR_TOKEN_NAMES, TAG_COLOR_TOKENS } from "../../lib/tagColors";
import { prepareCodeElement } from "../reader/richTextShared";
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

function selectText(element: HTMLElement, text: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    const startOffset = (textNode.textContent ?? "").indexOf(text);
    if (startOffset >= 0) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(textNode, startOffset);
      range.setEnd(textNode, startOffset + text.length);
      selection?.removeAllRanges();
      selection?.addRange(range);
      if (!selection) {
        throw new Error("Selection indisponivel no teste.");
      }
      return selection;
    }
    textNode = walker.nextNode();
  }

  throw new Error(`Texto nao encontrado no teste: ${text}`);
}

function installExecCommandMock(onAfterCommand?: () => void) {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    value: vi.fn((command: string, _showUi: boolean, value: string) => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) {
        return false;
      }

      const range = selection.getRangeAt(0);
      // Reproduz o Chromium/WebView2: `hiliteColor` nao materializa
      // `transparent`, portanto esse valor nao consegue remover o realce.
      if (command === "hiliteColor" && value === "transparent") {
        return true;
      }
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
      onAfterCommand?.();
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
    expect(editor.innerHTML).not.toContain("010203");

    selection = selectContents(editor);
    applyNotebookTextColor(editor, selection, "color", null);
    expect(editor.innerHTML).toBe("texto");
    expect(editor.querySelector("span")).toBeNull();
    expect(editor.innerHTML).not.toContain("010203");
  });

  it.each([
    ["highlight", "data-athenaeum-highlight"],
    ["color", "data-athenaeum-color"],
  ] as const)("aplica %s somente ao texto depois de blocos de codigo", (kind, attribute) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML =
      '<div><code style="display:block;background:#1E2130;color:#F0E6DC">codigo um</code>&nbsp;</div>' +
      '<div><code style="display:block;background:#1E2130;color:#F0E6DC">codigo dois</code>&nbsp;</div>' +
      '<h2>titulo alvo abaixo</h2>';
    document.body.append(editor);

    const selection = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, selection, kind, "amber")).not.toBeNull();

    expect(editor.querySelector(`[${attribute}="amber"]`)?.textContent).toBe("alvo");
    expect(selection.toString()).toBe("alvo");
    expect(editor.querySelector("h2")?.textContent).toBe("titulo alvo abaixo");
  });

  it.each([
    ["highlight", "data-athenaeum-highlight"],
    ["color", "data-athenaeum-color"],
  ] as const)("aplica %s somente ao texto dentro de bloco de codigo", (kind, attribute) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML =
      '<div><code style="display:block;background:#1E2130;color:#F0E6DC">codigo alvo interno</code>&nbsp;</div>' +
      '<h2>titulo abaixo</h2>';
    document.body.append(editor);

    const selection = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, selection, kind, "amber")).not.toBeNull();

    expect(editor.querySelector(`[${attribute}="amber"]`)?.textContent).toBe("alvo");
    expect(selection.toString()).toBe("alvo");
    expect(editor.querySelector("h2")?.textContent).toBe("titulo abaixo");
  });

  it.each([
    ["highlight", "data-athenaeum-highlight"],
    ["color", "data-athenaeum-color"],
  ] as const)("aplica %s somente ao texto depois de citacoes em bloco", (kind, attribute) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML =
      "<blockquote>citacao um</blockquote>" +
      "<blockquote>citacao dois</blockquote>" +
      "<h2>titulo alvo abaixo</h2>";
    document.body.append(editor);

    const selection = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, selection, kind, "amber")).not.toBeNull();

    expect(editor.querySelector(`[${attribute}="amber"]`)?.textContent).toBe("alvo");
    expect(selection.toString()).toBe("alvo");
    expect(editor.querySelector("h2")?.textContent).toBe("titulo alvo abaixo");
  });

  it.each([
    ["highlight", "data-athenaeum-highlight"],
    ["color", "data-athenaeum-color"],
  ] as const)("aplica %s somente ao texto dentro de citacao em bloco", (kind, attribute) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<blockquote>citacao alvo interna</blockquote><h2>titulo abaixo</h2>";
    document.body.append(editor);

    const selection = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, selection, kind, "amber")).not.toBeNull();

    expect(editor.querySelector(`[${attribute}="amber"]`)?.textContent).toBe("alvo");
    expect(selection.toString()).toBe("alvo");
    expect(editor.querySelector("h2")?.textContent).toBe("titulo abaixo");
  });

  it.each([
    ["highlight", "data-athenaeum-highlight"],
    ["color", "data-athenaeum-color"],
  ] as const)("aplica %s somente ao texto sem blocos anteriores", (kind, attribute) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML = "<div>texto comum anterior</div><h2>titulo alvo abaixo</h2>";
    document.body.append(editor);

    const selection = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, selection, kind, "amber")).not.toBeNull();

    expect(editor.querySelector(`[${attribute}="amber"]`)?.textContent).toBe("alvo");
    expect(selection.toString()).toBe("alvo");
    expect(editor.querySelector("h2")?.textContent).toBe("titulo alvo abaixo");
  });

  it.each([
    ["aplicar realce", "highlight", "amber"],
    ["aplicar cor da fonte", "color", "amber"],
    ["remover realce", "highlight", null],
    ["remover cor da fonte", "color", null],
  ] as const)("restaura o estilo de runtime do bloco de codigo depois de %s", (_label, kind, token) => {
    installExecCommandMock();
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.innerHTML =
      '<div><code style="display:block;background:#1E2130;color:#F0E6DC">codigo distante</code>&nbsp;</div>' +
      "<h2>titulo alvo abaixo</h2>";
    document.body.append(editor);

    // Referencia produzida pelo mesmo helper: a comparacao nao depende de como
    // o ambiente serializa o atributo style.
    const reference = document.createElement("code");
    prepareCodeElement(reference);

    // A remocao passa pelo mesmo applyNotebookTextColor, com o sentinela
    // #010203 no lugar do token. Aplicar a cor antes reproduz o fluxo real do
    // menu: "Remover" so aparece como acao sobre trecho ja colorido.
    if (token === null) {
      applyNotebookTextColor(editor, selectText(editor, "alvo"), kind, "amber");
    }

    const selection = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, selection, kind, token)).not.toBeNull();

    const code = editor.querySelector("code");
    expect(code?.getAttribute("style")).toBe(reference.getAttribute("style"));

    // Idempotencia: repetir a operacao nao duplica estilo nem cria nos no <code>.
    const repeated = selectText(editor, "alvo");
    expect(applyNotebookTextColor(editor, repeated, kind, token)).not.toBeNull();

    expect(editor.querySelectorAll("code")).toHaveLength(1);
    expect(editor.querySelector("code")?.getAttribute("style")).toBe(reference.getAttribute("style"));
    expect(editor.querySelector("code")?.childNodes).toHaveLength(1);
    expect(editor.querySelector("code")?.textContent).toBe("codigo distante");
    // O sentinela de remocao nunca sobrevive a normalizacao.
    expect(editor.innerHTML).not.toContain("010203");
  });

  it.each([
    ["highlight", "data-athenaeum-highlight", "codigo", "<div><code>codigo anterior</code>&nbsp;</div>"],
    ["color", "data-athenaeum-color", "codigo", "<div><code>codigo anterior</code>&nbsp;</div>"],
    ["highlight", "data-athenaeum-highlight", "citacao", "<blockquote>citacao anterior</blockquote>"],
    ["color", "data-athenaeum-color", "citacao", "<blockquote>citacao anterior</blockquote>"],
  ] as const)(
    "preserva a selecao original ao aplicar %s depois de %s",
    (kind, attribute, _context, previousBlock) => {
      const editor = document.createElement("div");
      editor.contentEditable = "true";
      editor.innerHTML = `${previousBlock}<h2>titulo alvo</h2><h3>selecao deslocada</h3>`;
      document.body.append(editor);

      installExecCommandMock(() => {
        selectText(editor, "deslocada");
      });

      const selection = selectText(editor, "alvo");
      const restoredRange = applyNotebookTextColor(editor, selection, kind, "amber");

      expect(editor.querySelector(`[${attribute}="amber"]`)?.textContent).toBe("alvo");
      expect(restoredRange?.toString()).toBe("alvo");
      expect(selection.toString()).toBe("alvo");
    },
  );
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
