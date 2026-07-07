// Escala proporcional dos blocos de diagrama: persistida como
// data-diagram-scale (inteiro 50..160, em % do tamanho natural) e aplicada em
// runtime por transform: scale() dentro do NotebookDiagramFrame. Diferente da
// antiga largura (data-diagram-width), que só estreitava o contêiner e
// provocava reflow, a escala amplia/reduz o conteúdo inteiro uniformemente.
// A ausência do atributo (ou o valor 100) significa tamanho natural.

export const diagramScaleMinPercent = 50;
export const diagramScaleMaxPercent = 160;
export const diagramScaleDefaultPercent = 100;
export const diagramScaleStepPercent = 5;
export const diagramScaleLargeStepPercent = 10;

// Variáveis runtime que nunca devem chegar ao HTML persistido: a da escala
// atual e a da largura da Macrofase 8 (legada, removida na migração).
export const diagramScaleCssVariable = "--notebook-diagram-scale";
export const legacyDiagramWidthCssVariable = "--notebook-diagram-width";

// Aceita apenas inteiros dentro do intervalo permitido; qualquer outro valor
// conta como inválido e vira null (tamanho natural).
export function parseDiagramScale(value: string | null | undefined): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsed = Number(trimmedValue);
  if (parsed < diagramScaleMinPercent || parsed > diagramScaleMaxPercent) {
    return null;
  }

  return parsed;
}

export function clampDiagramScale(value: number): number {
  if (!Number.isFinite(value)) {
    return diagramScaleDefaultPercent;
  }

  return Math.min(diagramScaleMaxPercent, Math.max(diagramScaleMinPercent, Math.round(value)));
}

export function stepDiagramScale(current: number, direction: -1 | 1, useLargeStep: boolean): number {
  const step = useLargeStep ? diagramScaleLargeStepPercent : diagramScaleStepPercent;
  return clampDiagramScale(current + direction * step);
}

// 100 é o padrão e não é persistido: null ou 100 removem o atributo.
export function applyDiagramScale(diagram: HTMLElement, scale: number | null) {
  if (scale === null || scale === diagramScaleDefaultPercent) {
    delete diagram.dataset.diagramScale;
    return;
  }

  diagram.dataset.diagramScale = String(scale);
}

// Leitor do atributo legado data-diagram-width (inteiro 40..100), usado só
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

// Garante que nenhuma variável CSS runtime de escala/largura sobrevive na
// serialização — o HTML salvo carrega apenas data-diagram-scale.
export function clearDiagramScaleRuntimeStyles(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-athenaeum-block="diagram"]').forEach((diagram) => {
    diagram.style.removeProperty(diagramScaleCssVariable);
    diagram.style.removeProperty(legacyDiagramWidthCssVariable);
    if (!diagram.getAttribute("style")) {
      diagram.removeAttribute("style");
    }
  });
}
