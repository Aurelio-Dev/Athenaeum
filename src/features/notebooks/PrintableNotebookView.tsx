import { useCallback, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

import { loadNotebookAssets, type NotebookAssetData } from "../../lib/database";
import type { NotebookPage } from "../../types/library";
import { prepareCodeElements } from "../reader/richTextShared";
import { normalizeCallouts } from "./notebookEditorCalloutDom";
import { clearDiagramPreviews, normalizeDiagrams } from "./notebookEditorDiagramDom";
import { clearEquationPreviews, normalizeEquations } from "./notebookEditorEquationDom";
import { clearFigurePreviews, hydrateNotebookAssetImages, normalizeFigures } from "./notebookEditorFigureDom";
import { sanitizeNotebookPrintContent } from "./notebookPrintContent";
import "./notebookPrint.css";

type PrintableNotebookViewProps = {
  pages: NotebookPage[];
  onReady: () => void;
};

type PrintableNotebookPageProps = {
  page: NotebookPage;
  loadAssets: (pageId: number) => Promise<NotebookAssetData[]>;
  onReady: (pageId: number) => void;
};

type AssetLoadTask = {
  pageId: number;
  resolve: (assets: NotebookAssetData[]) => void;
  reject: (reason: unknown) => void;
};

type LimitedNotebookAssetLoader = {
  load: (pageId: number) => Promise<NotebookAssetData[]>;
  cancel: () => void;
};

const notebookAssetLoadConcurrency = 2;

function pageDisplayTitle(page: NotebookPage) {
  return page.title?.trim() || `Página sem título ${page.position}`;
}

function createLimitedNotebookAssetLoader(concurrency: number): LimitedNotebookAssetLoader {
  const queue: AssetLoadTask[] = [];
  const loadsByPageId = new Map<number, Promise<NotebookAssetData[]>>();
  let activeLoads = 0;
  let cancelled = false;

  function startNextLoads() {
    while (!cancelled && activeLoads < concurrency && queue.length > 0) {
      const task = queue.shift();
      if (!task) {
        return;
      }

      activeLoads += 1;
      void loadNotebookAssets(task.pageId)
        .then(task.resolve, task.reject)
        .finally(() => {
          activeLoads -= 1;
          startNextLoads();
        });
    }
  }

  return {
    load: (pageId: number) => {
      const existingLoad = loadsByPageId.get(pageId);
      if (existingLoad) {
        return existingLoad;
      }

      const load = new Promise<NotebookAssetData[]>((resolve, reject) => {
        if (cancelled) {
          reject(new Error("Carregamento de assets cancelado."));
          return;
        }

        queue.push({ pageId, resolve, reject });
        startNextLoads();
      });
      loadsByPageId.set(pageId, load);
      void load.then(
        () => loadsByPageId.delete(pageId),
        () => loadsByPageId.delete(pageId),
      );
      return load;
    },
    cancel: () => {
      cancelled = true;
      queue.splice(0).forEach((task) => task.reject(new Error("Carregamento de assets cancelado.")));
    },
  };
}

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function waitForPrintableImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    images.map(async (image) => {
      if (typeof image.decode === "function") {
        try {
          await image.decode();
        } catch {
          // Imagem ausente/corrompida mantém o fallback visual do bloco e não
          // impede as demais páginas de serem impressas.
        }
        return;
      }

      if (image.complete) {
        return;
      }

      await new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );
}

function countExpectedRuntimePreviews(root: HTMLElement) {
  const diagramSelector = [
    '[data-athenaeum-block="diagram"]',
    '[data-athenaeum-block="figure"][data-figure-subtype="diagram"]',
    '[data-athenaeum-block="figure"][data-figure-subtype="graph-diagram"]',
    '[data-athenaeum-block="figure"][data-figure-subtype="flowchart"]',
  ].join(",");

  return root.querySelectorAll(diagramSelector).length +
    root.querySelectorAll('[data-athenaeum-block="equation"]').length;
}

function PrintableNotebookPage({ page, loadAssets, onReady }: PrintableNotebookPageProps) {
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }
    const printableContent = content;

    let cancelled = false;
    printableContent.innerHTML = sanitizeNotebookPrintContent(page.content);

    let pendingRuntimePreviews = countExpectedRuntimePreviews(printableContent);
    let resolveRuntimePreviews: (() => void) | null = null;
    const runtimePreviewsReady = new Promise<void>((resolve) => {
      resolveRuntimePreviews = resolve;
      if (pendingRuntimePreviews === 0) {
        resolve();
      }
    });

    function markRuntimePreviewReady() {
      pendingRuntimePreviews = Math.max(0, pendingRuntimePreviews - 1);
      if (pendingRuntimePreviews === 0) {
        resolveRuntimePreviews?.();
      }
    }

    async function preparePage() {
      try {
        normalizeCallouts(printableContent);
        prepareCodeElements(printableContent);
        normalizeDiagrams(printableContent, markRuntimePreviewReady);
        normalizeEquations(printableContent, markRuntimePreviewReady);
        normalizeFigures(printableContent);

        try {
          const assets = await loadAssets(page.id);
          if (!cancelled) {
            hydrateNotebookAssetImages(printableContent, assets);
          }
        } catch (error) {
          if (!cancelled) {
            console.warn("Nao foi possivel carregar imagens para impressao do caderno.", error);
          }
        }

        await runtimePreviewsReady;
        // Os roots React de figuras são montados após a hidratação. Dois frames
        // permitem o commit e a medição antes de aguardar o decode das imagens.
        await waitForAnimationFrame();
        await waitForAnimationFrame();
        await waitForPrintableImages(printableContent);

        if (!cancelled) {
          onReady(page.id);
        }
      } catch (error) {
        console.warn("Nao foi possivel preparar completamente uma pagina para impressao.", error);
        if (!cancelled) {
          onReady(page.id);
        }
      }
    }

    void preparePage();

    return () => {
      cancelled = true;
      clearDiagramPreviews(printableContent);
      clearEquationPreviews(printableContent);
      clearFigurePreviews(printableContent);
      printableContent.replaceChildren();
    };
  }, [loadAssets, onReady, page]);

  return (
    <section className="notebook-print-page">
      <h1 className="notebook-print-page-title">{pageDisplayTitle(page)}</h1>
      <div
        ref={contentRef}
        className="notebook-editor notebook-editor--spaced notebook-editor--diagram-clean-mode notebook-print-page-content"
      />
    </section>
  );
}

export function PrintableNotebookView({ pages, onReady }: PrintableNotebookViewProps) {
  const readyPageIdsRef = useRef(new Set<number>());
  const hasSignaledReadyRef = useRef(false);
  const isMountedRef = useRef(false);
  const assetLoaderCancelTimerRef = useRef<number | null>(null);
  const assetLoader = useMemo(() => createLimitedNotebookAssetLoader(notebookAssetLoadConcurrency), []);

  useEffect(() => {
    if (assetLoaderCancelTimerRef.current !== null) {
      window.clearTimeout(assetLoaderCancelTimerRef.current);
      assetLoaderCancelTimerRef.current = null;
    }
    isMountedRef.current = true;
    document.body.classList.add("notebook-print-active");
    return () => {
      isMountedRef.current = false;
      // O atraso de um tick distingue o unmount real do ciclo extra de efeitos
      // do React.StrictMode em desenvolvimento; um remount imediato cancela-o.
      assetLoaderCancelTimerRef.current = window.setTimeout(() => assetLoader.cancel(), 0);
      document.body.classList.remove("notebook-print-active");
    };
  }, [assetLoader]);

  useEffect(() => {
    readyPageIdsRef.current.clear();
    hasSignaledReadyRef.current = false;
  }, [pages]);

  const handlePageReady = useCallback(
    (pageId: number) => {
      readyPageIdsRef.current.add(pageId);
      if (hasSignaledReadyRef.current || readyPageIdsRef.current.size !== pages.length) {
        return;
      }

      hasSignaledReadyRef.current = true;
      void (async () => {
        if (document.fonts) {
          await document.fonts.ready;
        }
        await waitForAnimationFrame();
        await waitForAnimationFrame();
        if (isMountedRef.current) {
          onReady();
        }
      })();
    },
    [onReady, pages.length],
  );

  return createPortal(
    <main className="notebook-print-root" aria-label="Visualização do caderno para impressão">
      {pages.map((page) => (
        <PrintableNotebookPage key={page.id} page={page} loadAssets={assetLoader.load} onReady={handlePageReady} />
      ))}
    </main>,
    document.body,
  );
}
