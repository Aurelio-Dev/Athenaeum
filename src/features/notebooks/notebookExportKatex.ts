import katex from "katex";

export type NotebookEquationStaticRenderStatus = "rendered" | "fallback";

export type NotebookEquationStaticRenderResult = {
  status: NotebookEquationStaticRenderStatus;
  html: string;
  source: string;
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeEquationFallbackSource(value: string) {
  return escapeHtml(value)
    .replace(/\b(javascript|file|blob):/gi, "$1&#58;")
    .replace(/\bon(error|click)=/gi, (match) => `${match.slice(0, -1)}&#61;`);
}

function renderEquationFallback(source: string, message: string) {
  const sourceHtml =
    source.length > 0 ? `<code class="athenaeum-export__equation-source">${escapeEquationFallbackSource(source)}</code>` : "";

  return `<div class="athenaeum-export__equation-fallback" role="note">
  <strong>Equacao nao renderizada</strong>
  <span>${escapeHtml(message)}</span>
  ${sourceHtml}
</div>`;
}

function hasUnsafeRenderedEquationHtml(html: string) {
  return /<script|<img|\son[a-z]+\s*=|javascript:|file:|blob:/i.test(html);
}

export async function loadNotebookExportKatexStyles() {
  const { katexMinCss } = await import("./notebookExportKatexCss.generated");
  return katexMinCss;
}

export async function resolveNotebookExportKatexStyles(
  hasRenderedEquation: boolean,
  loadStyles: () => Promise<string> = loadNotebookExportKatexStyles,
) {
  return hasRenderedEquation ? loadStyles() : "";
}

export function renderNotebookEquationStaticHtml(source: string): NotebookEquationStaticRenderResult {
  const normalizedSource = source.trim();

  if (normalizedSource.length === 0) {
    return {
      status: "fallback",
      html: renderEquationFallback(normalizedSource, "A equacao nao possui fonte LaTeX."),
      source: normalizedSource,
    };
  }

  try {
    const renderedHtml = katex.renderToString(normalizedSource, {
      displayMode: true,
      throwOnError: false,
      trust: false,
      output: "htmlAndMathml",
    });

    if (renderedHtml.includes("katex-error")) {
      return {
        status: "fallback",
        html: renderEquationFallback(normalizedSource, "Sintaxe LaTeX invalida."),
        source: normalizedSource,
      };
    }

    if (hasUnsafeRenderedEquationHtml(renderedHtml)) {
      return {
        status: "fallback",
        html: renderEquationFallback(normalizedSource, "A equacao contem conteudo inseguro."),
        source: normalizedSource,
      };
    }

    return {
      status: "rendered",
      html: `<div class="athenaeum-export__equation-rendered">${renderedHtml}</div>`,
      source: normalizedSource,
    };
  } catch {
    return {
      status: "fallback",
      html: renderEquationFallback(normalizedSource, "Sintaxe LaTeX invalida."),
      source: normalizedSource,
    };
  }
}
