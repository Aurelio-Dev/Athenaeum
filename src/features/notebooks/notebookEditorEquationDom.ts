import katex from "katex";

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

export function renderEquationPreview(equation: HTMLElement) {
  const source = getEquationSource(equation);
  const preview = equation.querySelector<HTMLElement>('[data-equation-preview="true"]');

  if (!source || !preview) {
    return;
  }

  const sourceText = (source.textContent ?? "").trim();
  preview.contentEditable = "false";

  if (!sourceText) {
    preview.replaceChildren();
    return;
  }

  try {
    katex.render(sourceText, preview, {
      displayMode: true,
      throwOnError: false,
      trust: false,
    });
  } catch (error) {
    console.warn("Nao foi possivel renderizar equacao com KaTeX.", error);
    preview.textContent = sourceText;
  }
}

export function clearEquationPreviews(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-equation-preview="true"]').forEach((preview) => {
    preview.replaceChildren();
    preview.contentEditable = "false";
  });
}

export function normalizeEquations(editor: HTMLElement) {
  editor.querySelectorAll<HTMLElement>('[data-athenaeum-block="equation"]').forEach((equation) => {
    if (equation.tagName.toLowerCase() !== "figure") {
      const sourceText = equation.textContent ?? "";
      const nextEquation = document.createElement("figure");
      nextEquation.dataset.athenaeumBlock = "equation";
      nextEquation.append(createEquationPreviewElement(), createEquationSourceElement(sourceText));
      equation.replaceWith(nextEquation);
      renderEquationPreview(nextEquation);
      return;
    }

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

    renderEquationPreview(equation);
  });
}
