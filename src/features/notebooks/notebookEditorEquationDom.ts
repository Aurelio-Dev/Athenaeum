import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { NotebookEquationPreview } from "./NotebookEquationPreview";
import { applyEquationScale, parseEquationScale } from "./notebookDiagramScale";

type EquationPreviewRoot = {
  host: HTMLDivElement;
  root: Root;
};

const equationPreviewRoots = new WeakMap<HTMLElement, EquationPreviewRoot>();

export const notebookEquationCleanModeClassName = "notebook-equation--clean-mode";
export const notebookEquationActiveClassName = "notebook-equation--active";

export function clearEquationRuntimeClasses(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('[data-athenaeum-block="equation"]').forEach((equation) => {
    equation.classList.remove(notebookEquationCleanModeClassName, notebookEquationActiveClassName);
  });
}

export function findClosestEquation(node: Node | null, editor: HTMLElement): HTMLElement | null {
  const element = node instanceof Element ? node : node?.parentElement;
  const equation = element?.closest('[data-athenaeum-block="equation"]');

  return equation instanceof HTMLElement && editor.contains(equation) ? equation : null;
}

export function getEquationSource(equation: HTMLElement): HTMLElement | null {
  const source = equation.querySelector<HTMLElement>('[data-equation-source="true"]');
  return source;
}

function createEquationPreviewElement() {
  const preview = document.createElement("div");
  preview.dataset.equationPreview = "true";
  preview.contentEditable = "false";
  return preview;
}

function createEquationSourceElement(sourceText: string) {
  const source = document.createElement("figcaption");
  source.dataset.equationSource = "true";
  source.spellcheck = false;
  source.setAttribute("spellcheck", "false");
  source.textContent = sourceText;
  return source;
}

function sourceContainsMarkup(source: HTMLElement) {
  return Array.from(source.childNodes).some((child) => child.nodeType !== Node.TEXT_NODE);
}

function unmountEquationPreview(preview: HTMLElement) {
  const mountedPreview = equationPreviewRoots.get(preview);
  if (!mountedPreview) {
    return;
  }

  mountedPreview.root.unmount();
  equationPreviewRoots.delete(preview);
}

function renderReactEquationPreview(preview: HTMLElement, sourceText: string, onReady?: () => void) {
  if (!document.body.contains(preview)) {
    preview.textContent = sourceText;
    onReady?.();
    return;
  }

  const mountedPreview = equationPreviewRoots.get(preview);
  const host = mountedPreview?.host.parentElement === preview ? mountedPreview.host : document.createElement("div");
  let root = mountedPreview?.host.parentElement === preview ? mountedPreview.root : null;

  if (!root) {
    unmountEquationPreview(preview);
    root = createRoot(host);
    equationPreviewRoots.set(preview, { host, root });
  }

  preview.replaceChildren(host);
  root.render(createElement(NotebookEquationPreview, { source: sourceText, onReady }));
}

export function renderEquationPreview(equation: HTMLElement, onReady?: () => void) {
  const source = getEquationSource(equation);
  const preview = equation.querySelector<HTMLElement>('[data-equation-preview="true"]');

  if (!source || !preview) {
    onReady?.();
    return;
  }

  const sourceText = (source.textContent ?? "").trim();
  preview.contentEditable = "false";

  if (!sourceText) {
    unmountEquationPreview(preview);
    preview.replaceChildren();
    onReady?.();
    return;
  }

  renderReactEquationPreview(preview, sourceText, onReady);
}

export function clearEquationPreviews(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-equation-preview="true"]').forEach((preview) => {
    unmountEquationPreview(preview);
    preview.replaceChildren();
    preview.contentEditable = "false";
  });
}

function normalizeEquationScale(equation: HTMLElement) {
  applyEquationScale(equation, parseEquationScale(equation.dataset.equationScale));
}

export function normalizeEquations(editor: HTMLElement, onPreviewReady?: (equation: HTMLElement) => void) {
  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="equation"]').forEach((equation) => {
    if (equation.tagName.toLowerCase() !== "figure") {
      const sourceText = equation.textContent ?? "";
      const nextEquation = document.createElement("figure");
      nextEquation.dataset.athenaeumBlock = "equation";
      nextEquation.append(createEquationPreviewElement(), createEquationSourceElement(sourceText));
      equation.replaceWith(nextEquation);
      renderEquationPreview(nextEquation, () => onPreviewReady?.(nextEquation));
      return;
    }

    normalizeEquationScale(equation);

    let preview = equation.querySelector<HTMLElement>(':scope > [data-equation-preview="true"]');
    if (!preview) {
      preview = createEquationPreviewElement();
      equation.prepend(preview);
    }
    preview.contentEditable = "false";

    let source = equation.querySelector<HTMLElement>(':scope > [data-equation-source="true"]');
    if (!source) {
      source = createEquationSourceElement(equation.textContent ?? "");
      equation.appendChild(source);
    }
    source.spellcheck = false;
    source.setAttribute("spellcheck", "false");

    if (sourceContainsMarkup(source)) {
      source.textContent = source.textContent ?? "";
    }

    renderEquationPreview(equation, () => onPreviewReady?.(equation));
  });
}
