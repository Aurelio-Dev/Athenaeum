// Escala proporcional dos blocos redimensionaveis: persistida como inteiro
// 50..160, em % do tamanho natural, e aplicada em runtime pelo frame de
// redimensionamento. A ausencia do atributo (ou o valor 100) significa tamanho
// natural.

export const resizableScaleMinPercent = 50;
export const resizableScaleMaxPercent = 160;
export const resizableScaleDefaultPercent = 100;
export const resizableScaleStepPercent = 5;
export const resizableScaleLargeStepPercent = 10;

export const diagramScaleMinPercent = resizableScaleMinPercent;
export const diagramScaleMaxPercent = resizableScaleMaxPercent;
export const diagramScaleDefaultPercent = resizableScaleDefaultPercent;
export const diagramScaleStepPercent = resizableScaleStepPercent;
export const diagramScaleLargeStepPercent = resizableScaleLargeStepPercent;

// Variaveis runtime que nunca devem chegar ao HTML persistido: a da escala
// atual e a da largura da Macrofase 8 (legada, removida na migracao).
export const diagramScaleCssVariable = "--notebook-diagram-scale";
export const legacyDiagramWidthCssVariable = "--notebook-diagram-width";

// Aceita apenas inteiros dentro do intervalo permitido; qualquer outro valor
// conta como invalido e vira null (tamanho natural).
export function parseResizableScale(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsed = Number(trimmedValue);
  if (parsed < resizableScaleMinPercent || parsed > resizableScaleMaxPercent) {
    return null;
  }

  return parsed;
}

export function clampResizableScale(value: number): number {
  if (!Number.isFinite(value)) {
    return resizableScaleDefaultPercent;
  }

  return Math.min(resizableScaleMaxPercent, Math.max(resizableScaleMinPercent, Math.round(value)));
}

// Serializacao estavel: valores invalidos/default nao geram atributo; valores
// validos saem como inteiro sem casas decimais.
export function serializeResizableScale(scale: number | null): string | null {
  if (scale === null) {
    return null;
  }

  const clampedScale = clampResizableScale(scale);
  return clampedScale === resizableScaleDefaultPercent ? null : String(clampedScale);
}

export function applyResizableScale(element: HTMLElement, datasetKey: string, scale: number | null) {
  const serializedScale = serializeResizableScale(scale);

  if (serializedScale === null) {
    delete element.dataset[datasetKey];
    return;
  }

  element.dataset[datasetKey] = serializedScale;
}

export function parseDiagramScale(value: string | null | undefined): number | null {
  return parseResizableScale(value);
}

export function clampDiagramScale(value: number): number {
  return clampResizableScale(value);
}

export function stepDiagramScale(current: number, direction: -1 | 1, useLargeStep: boolean): number {
  const step = useLargeStep ? resizableScaleLargeStepPercent : resizableScaleStepPercent;
  return clampDiagramScale(current + direction * step);
}

// 100 e o padrao e nao e persistido: null ou 100 removem o atributo.
export function applyDiagramScale(diagram: HTMLElement, scale: number | null) {
  applyResizableScale(diagram, "diagramScale", scale);
}

export function parseEquationScale(value: string | null | undefined): number | null {
  return parseResizableScale(value);
}

export function applyEquationScale(equation: HTMLElement, scale: number | null) {
  applyResizableScale(equation, "equationScale", scale);
}

export function parseFigureScale(value: string | null | undefined): number | null {
  return parseResizableScale(value);
}

export function applyFigureScale(figure: HTMLElement, scale: number | null) {
  applyResizableScale(figure, "figureScale", scale);
}

// Leitor do atributo legado data-diagram-width (inteiro 40..100), usado so
// para migrar blocos antigos para uma escala inicial aproximada.
export function parseLegacyDiagramWidthPercent(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsed = Number(trimmedValue);
  if (parsed < 40 || parsed > 100) {
    return null;
  }

  return parsed;
}

// Garante que nenhuma variavel CSS runtime de escala/largura sobrevive na
// serializacao. O HTML salvo carrega apenas atributos data-* semanticos.
export function clearDiagramScaleRuntimeStyles(root: HTMLElement) {
  root
    .querySelectorAll<HTMLElement>(
      '[data-athenaeum-block="diagram"], [data-athenaeum-block="equation"], [data-athenaeum-block="figure"]',
    )
    .forEach((block) => {
      block.style.removeProperty(diagramScaleCssVariable);
      block.style.removeProperty(legacyDiagramWidthCssVariable);
      if (!block.getAttribute("style")) {
        block.removeAttribute("style");
      }
    });
}

export function getResolvedResizableScale(value: string | null | undefined) {
  return parseResizableScale(value) ?? resizableScaleDefaultPercent;
}

export function isResizableScaleAttribute(name: string) {
  return name === "data-diagram-scale" || name === "data-equation-scale" || name === "data-figure-scale";
}

export function getResizableScaleDatasetKey(attributeName: string) {
  if (attributeName === "data-diagram-scale") {
    return "diagramScale";
  }

  if (attributeName === "data-equation-scale") {
    return "equationScale";
  }

  if (attributeName === "data-figure-scale") {
    return "figureScale";
  }

  return null;
}

export function setSanitizedResizableScaleAttribute(
  target: HTMLElement,
  attributeName: string,
  rawValue: string | null | undefined,
) {
  const datasetKey = getResizableScaleDatasetKey(attributeName);
  if (!datasetKey) {
    return;
  }

  const scale = parseResizableScale(rawValue);
  if (scale !== null) {
    applyResizableScale(target, datasetKey, scale);
  } else {
    delete target.dataset[datasetKey];
  }
}

export function getExportScaleWidthPercent(rawValue: string | null | undefined) {
  const scale = parseResizableScale(rawValue);
  if (scale === null || scale === resizableScaleDefaultPercent) {
    return null;
  }

  return scale;
}

export function appendExportScaleStyle(target: HTMLElement, scalePercent: number | null) {
  if (scalePercent === null) {
    return;
  }

  const scaleStyle =
    `--athenaeum-export-block-width: ${scalePercent}%; ` +
    "width: var(--athenaeum-export-block-width); max-width: 100%; margin-inline: auto";
  const currentStyle = target.getAttribute("style");
  target.setAttribute("style", currentStyle ? `${currentStyle}; ${scaleStyle}` : scaleStyle);
}

export function applyExportScaleAttributeAndStyle(
  target: HTMLElement,
  attributeName: string,
  rawValue: string | null | undefined,
) {
  setSanitizedResizableScaleAttribute(target, attributeName, rawValue);
  appendExportScaleStyle(target, getExportScaleWidthPercent(rawValue));
}

export function applyExportScaleFromPercent(target: HTMLElement, attributeName: string, scalePercent: number) {
  const serializedScale = serializeResizableScale(scalePercent);
  const datasetKey = getResizableScaleDatasetKey(attributeName);

  if (serializedScale === null) {
    if (datasetKey) {
      delete target.dataset[datasetKey];
    }
    return;
  }

  setSanitizedResizableScaleAttribute(target, attributeName, serializedScale);
  appendExportScaleStyle(target, Number(serializedScale));
}
