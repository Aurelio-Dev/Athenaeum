// @vitest-environment jsdom

import { act } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { clearDiagramPreviews, normalizeDiagrams } from "./notebookEditorDiagramDom";
import { clearEquationPreviews, normalizeEquations } from "./notebookEditorEquationDom";

class ResizeObserverStub implements ResizeObserver {
  disconnect() {}
  observe() {}
  unobserve() {}
}

beforeAll(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("prontidão dos previews do Caderno", () => {
  it("sinaliza o diagrama somente depois de o SVG React existir no DOM", async () => {
    const editor = document.createElement("div");
    editor.innerHTML = `
      <figure data-athenaeum-block="diagram" data-diagram-kind="diagram">
        <figcaption data-diagram-source="true">A -&gt; B</figcaption>
      </figure>
    `;
    document.body.appendChild(editor);
    let svgWasPresentWhenReady = false;

    await act(async () => {
      normalizeDiagrams(editor, (diagram) => {
        svgWasPresentWhenReady = diagram.querySelector("svg") !== null;
      });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(svgWasPresentWhenReady).toBe(true);
    expect(editor.querySelector("svg")).not.toBeNull();
    await act(async () => clearDiagramPreviews(editor));
  });

  it("sinaliza a equação depois de o KaTeX preencher o host", async () => {
    const editor = document.createElement("div");
    editor.innerHTML = `
      <figure data-athenaeum-block="equation">
        <figcaption data-equation-source="true">E = mc^2</figcaption>
      </figure>
    `;
    document.body.appendChild(editor);
    let katexWasPresentWhenReady = false;

    await act(async () => {
      normalizeEquations(editor, (equation) => {
        katexWasPresentWhenReady = equation.querySelector(".katex") !== null;
      });
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(katexWasPresentWhenReady).toBe(true);
    expect(editor.querySelector(".katex")).not.toBeNull();
    await act(async () => clearEquationPreviews(editor));
  });
});
