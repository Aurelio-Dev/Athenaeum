import type { NotebookPage } from "../../types/library";

// Limite global para a preparação visual. Dez segundos dão margem para IPC,
// KaTeX, SVG, fontes e imagens sem deixar a impressão presa indefinidamente.
export const notebookPrintReadyTimeoutMs = 10_000;

function pageDisplayTitle(page: NotebookPage) {
  return page.title?.trim() || `Página sem título ${page.position}`;
}

export function buildNotebookPrintDocumentTitle(notebookTitle: string, pages: NotebookPage[]) {
  const safeNotebookTitle = notebookTitle.trim() || "Caderno sem título";
  const selectionContext = pages.length === 1 ? pageDisplayTitle(pages[0]) : `${pages.length} páginas`;
  return `Caderno - ${safeNotebookTitle} - ${selectionContext}`;
}

type BeginNotebookPrintSessionOptions = {
  title: string;
  print?: () => void;
  onAfterPrint: () => void;
};

export function beginNotebookPrintSession({
  title,
  print = () => window.print(),
  onAfterPrint,
}: BeginNotebookPrintSessionOptions) {
  const originalTitle = document.title;
  let finished = false;

  function restoreTitle() {
    if (finished) {
      return;
    }

    finished = true;
    window.removeEventListener("afterprint", handleAfterPrint);
    document.title = originalTitle;
  }

  function handleAfterPrint() {
    restoreTitle();
    onAfterPrint();
  }

  window.addEventListener("afterprint", handleAfterPrint, { once: true });
  document.title = title;

  try {
    print();
  } catch (error) {
    restoreTitle();
    throw error;
  }

  // O chamador usa restore no cleanup defensivo caso o painel seja desmontado
  // antes de o WebView emitir afterprint.
  return { restore: restoreTitle };
}
