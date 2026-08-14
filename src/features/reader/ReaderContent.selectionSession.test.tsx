// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NewAnnotation } from "../../lib/database";
import type {
  Annotation,
  AnnotationMarkStyle,
  AnnotationSaveState,
  HighlightColor,
} from "../../types/annotation";
import type { LibraryDocument } from "../../types/library";
import type { CapturedSelection } from "./anchor";
import { ReaderContent } from "./ReaderContent";

const databaseMocks = vi.hoisted(() => ({
  createAnnotation: vi.fn(),
  updateAnnotationMark: vi.fn(),
  listAnnotations: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
}));

const anchorMocks = vi.hoisted(() => ({
  captureSelection: vi.fn(),
}));

const pdfMocks = vi.hoisted(() => {
  const pdfDocument = {
    numPages: 2,
    getOutline: vi.fn(async () => []),
  };
  const loadingTask = {
    promise: Promise.resolve(pdfDocument),
    destroy: vi.fn(async () => undefined),
  };

  return {
    pdfDocument,
    loadingTask,
    getDocument: vi.fn(() => loadingTask),
  };
});

vi.mock("../../lib/database", () => ({
  createAnnotation: databaseMocks.createAnnotation,
  deleteAnnotation: vi.fn(async () => undefined),
  getLatestLinkedNotebook: vi.fn(async () => null),
  getLibraryDocument: vi.fn(async () => null),
  getDocumentNotes: vi.fn(async () => ""),
  openDocumentExternally: vi.fn(async () => undefined),
  isReaderDocumentPayload: vi.fn(() => false),
  isReaderInvalidationPayload: vi.fn(() => false),
  isReaderJumpToPagePayload: vi.fn(() => false),
  listAnnotations: databaseMocks.listAnnotations,
  listAvailableTags: vi.fn(async () => []),
  listAvailableTagsFromPreloadedDatabase: vi.fn(async () => []),
  listNotebookOptions: vi.fn(async () => []),
  READER_ANNOTATIONS_CHANGED_EVENT: "reader-annotations-changed",
  READER_DETAILS_CHANGED_EVENT: "reader-details-changed",
  READER_JUMP_TO_PAGE_EVENT: "reader-jump-to-page",
  READER_NOTES_CHANGED_EVENT: "reader-notes-changed",
  READER_PAGE_STATE_CHANGED_EVENT: "reader-page-state-changed",
  READER_PAGE_STATE_REQUESTED_EVENT: "reader-page-state-requested",
  READER_PANEL_WINDOW_LABEL: "reader-panel",
  READER_POPOUT_CLOSED_EVENT: "reader-popout-closed",
  READER_POPOUT_STATUS_CHANGED_EVENT: "reader-popout-status-changed",
  READER_POPOUT_STATUS_REQUESTED_EVENT: "reader-popout-status-requested",
  getSetting: databaseMocks.getSetting,
  setDocumentReadingLocation: vi.fn(async () => undefined),
  setDocumentReadingStarted: vi.fn(async () => undefined),
  setSetting: databaseMocks.setSetting,
  updateAnnotationMark: databaseMocks.updateAnnotationMark,
  updateAnnotationNote: vi.fn(async () => undefined),
}));

vi.mock("./anchor", () => ({
  captureSelection: anchorMocks.captureSelection,
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: pdfMocks.getDocument,
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "pdf-worker.js" }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(async () => undefined) }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

vi.mock("@tauri-apps/api/event", () => ({
  emitTo: vi.fn(async () => undefined),
  listen: vi.fn(async () => () => undefined),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({
    label: "reader-test",
    isFullscreen: vi.fn(async () => false),
    setFullscreen: vi.fn(async () => undefined),
    onResized: vi.fn(async () => () => undefined),
  }),
}));

vi.mock("../../hooks/useInViewport", () => ({
  useInViewport: () => ({ elementRef: vi.fn(), isInViewport: false }),
}));

vi.mock("./useReaderPersistence", () => ({
  useReaderPersistence: () => ({ schedule: vi.fn(), cancel: vi.fn() }),
}));

vi.mock("./useReadingTimer", () => ({
  useReadingTimer: () => ({ timeSpentSeconds: 0, flushReadingTime: vi.fn(async () => undefined) }),
}));

vi.mock("./ReaderChrome", async () => {
  const { createElement } = await import("react");

  return {
    ReaderFloatingChrome: () => null,
    ReaderToolRail: ({ onAnnotate }: { onAnnotate: () => void }) => createElement(
      "button",
      { type: "button", "data-testid": "annotate", onClick: onAnnotate },
      "Anotar",
    ),
  };
});

vi.mock("./ReaderLeftSidebar", () => ({
  ReaderLeftSidebar: () => null,
  readerLeftSidebarWidth: 308,
}));

vi.mock("./SelectionToolbar", async () => {
  const { createElement } = await import("react");
  const colors: HighlightColor[] = ["amber", "violet", "blue", "rose"];

  return {
    SelectionToolbar: ({
      onApplyMark,
    }: {
      onApplyMark: (style: AnnotationMarkStyle, color: HighlightColor) => void;
    }) => createElement(
      "div",
      { "data-testid": "selection-toolbar" },
      colors.map((color) => createElement(
        "button",
        {
          key: color,
          type: "button",
          "data-testid": `apply-${color}`,
          onClick: () => onApplyMark("highlight", color),
        },
        color,
      )),
    ),
  };
});

vi.mock("./ReaderAnnotationsDock", async () => {
  const { createElement } = await import("react");

  type DockProps = {
    annotations: Annotation[];
    saveStates: ReadonlyMap<string, AnnotationSaveState>;
    onRetry: (annotationId: string) => void;
  };

  return {
    ReaderAnnotationsDock: ({ annotations, saveStates, onRetry }: DockProps) => createElement(
      "div",
      { "data-testid": "annotations" },
      annotations.map((annotation) => createElement(
        "div",
        {
          key: annotation.id,
          "data-annotation-page": String(annotation.page),
          "data-annotation-id": annotation.id,
          "data-annotation-style": annotation.markStyle,
          "data-annotation-color": annotation.color,
          "data-save-state": saveStates.get(annotation.id) ?? "saved",
        },
        saveStates.get(annotation.id) === "unsaved"
          ? createElement(
            "button",
            {
              type: "button",
              "data-retry-id": annotation.id,
              onClick: () => onRetry(annotation.id),
            },
            "Tentar novamente",
          )
          : null,
      )),
    ),
  };
});

vi.mock("./HighlightLayer", () => ({ HighlightLayer: () => null }));
vi.mock("./PdfTextLayer", () => ({ PdfTextLayer: () => null }));
vi.mock("./NotePopover", () => ({ NotePopover: () => null }));

const testDocument: LibraryDocument = {
  id: "document-1",
  title: "Documento de teste",
  description: "",
  authors: [],
  source: "",
  year: 2026,
  tags: [],
  status: "in-progress",
  progress: 0,
  favorite: false,
  collection: "collection-1",
  updatedAt: "2026-08-12T00:00:00.000Z",
  fileUrl: "mock://document.pdf",
  annotationsFilterScope: "all",
  timeSpentSeconds: 0,
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function selectionWithPages(pageCount: number): CapturedSelection {
  return {
    text: "Texto selecionado",
    anchor: { top: 100, left: 200, width: 120 },
    pages: Array.from({ length: pageCount }, (_, index) => ({
      page: index + 1,
      rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
    })),
  };
}

function savedAnnotation(payload: NewAnnotation, id = `saved-${payload.page}`): Annotation {
  return {
    id,
    ...payload,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => void, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  let latestError: unknown;

  while (Date.now() < deadline) {
    try {
      assertion();
      return;
    } catch (error) {
      latestError = error;
    }

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
  }

  throw latestError;
}

function getElement(selector: string): HTMLElement {
  const element = container?.querySelector<HTMLElement>(selector);
  if (!element) {
    throw new Error(`Elemento nao encontrado: ${selector}`);
  }
  return element;
}

function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

function annotationForPage(page: number) {
  return getElement(`[data-annotation-page="${page}"]`);
}

async function mountReader(pageCount: number) {
  anchorMocks.captureSelection.mockReturnValue(selectionWithPages(pageCount));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root?.render(
      <ReaderContent
        document={testDocument}
        onClose={vi.fn()}
        onSaveNotes={vi.fn(async () => undefined)}
        onNotesReloaded={vi.fn()}
        onToggleFavorite={vi.fn(async () => undefined)}
        readerPanelSize={{ width: 1200, height: 800 }}
        isReaderMaximized={false}
        isActiveForShortcuts={false}
        onNativeFullscreenVisualStateChange={vi.fn()}
      >
        {({ body }: { body: ReactNode }) => body}
      </ReaderContent>,
    );
  });

  await waitFor(() => {
    expect(container?.textContent).not.toContain("Carregando PDF");
  });

  await act(async () => {
    getElement("main").dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });

  await waitFor(() => {
    expect(getElement('[data-testid="selection-toolbar"]')).toBeTruthy();
  });
}

beforeEach(() => {
  databaseMocks.createAnnotation.mockReset();
  databaseMocks.createAnnotation.mockImplementation(async (payload: NewAnnotation) => savedAnnotation(payload));
  databaseMocks.updateAnnotationMark.mockReset();
  databaseMocks.updateAnnotationMark.mockResolvedValue(undefined);
  databaseMocks.listAnnotations.mockReset();
  databaseMocks.listAnnotations.mockResolvedValue([]);
  databaseMocks.getSetting.mockReset();
  databaseMocks.getSetting.mockResolvedValue(null);
  databaseMocks.setSetting.mockReset();
  databaseMocks.setSetting.mockResolvedValue(undefined);
  anchorMocks.captureSelection.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  root = null;
  container = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("sessao de selecao do Reader", () => {
  it("cria uma anotacao por pagina na primeira aplicacao", async () => {
    await mountReader(2);

    act(() => click(getElement('[data-testid="apply-amber"]')));

    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2));
    expect(databaseMocks.createAnnotation.mock.calls.map(([payload]) => payload.page)).toEqual([1, 2]);
    expect(databaseMocks.createAnnotation.mock.calls.every(([payload]) => (
      payload.markStyle === "highlight" && payload.color === "amber"
    ))).toBe(true);
    expect(annotationForPage(1).dataset.annotationId).toBe("saved-1");
    expect(annotationForPage(2).dataset.annotationId).toBe("saved-2");
  });

  it("atualiza as mesmas linhas na segunda aplicacao sem criar duplicatas", async () => {
    await mountReader(2);

    act(() => click(getElement('[data-testid="apply-amber"]')));
    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2));
    act(() => click(getElement('[data-testid="apply-blue"]')));

    await waitFor(() => expect(databaseMocks.updateAnnotationMark).toHaveBeenCalledTimes(2));
    expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2);
    expect(databaseMocks.updateAnnotationMark.mock.calls).toEqual([
      ["saved-1", "highlight", "blue", "loaded"],
      ["saved-2", "highlight", "blue", "loaded"],
    ]);
    expect(annotationForPage(1).dataset.annotationColor).toBe("blue");
    expect(annotationForPage(2).dataset.annotationColor).toBe("blue");
  });

  it("serializa aplicacoes rapidas e preserva como resultado a ultima marcacao pedida", async () => {
    const firstInsert = deferred<Annotation>();
    databaseMocks.createAnnotation
      .mockImplementationOnce(() => firstInsert.promise)
      .mockImplementation(async (payload: NewAnnotation) => savedAnnotation(payload));
    await mountReader(2);

    act(() => {
      click(getElement('[data-testid="apply-amber"]'));
      click(getElement('[data-testid="apply-rose"]'));
    });

    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(1));
    expect(databaseMocks.updateAnnotationMark).not.toHaveBeenCalled();
    const firstPayload = databaseMocks.createAnnotation.mock.calls[0][0] as NewAnnotation;

    firstInsert.resolve(savedAnnotation(firstPayload));

    await waitFor(() => expect(databaseMocks.updateAnnotationMark).toHaveBeenCalledTimes(2));
    expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2);
    expect(databaseMocks.updateAnnotationMark.mock.calls.every(([, style, color]) => (
      style === "highlight" && color === "rose"
    ))).toBe(true);
    expect(annotationForPage(1).dataset.annotationColor).toBe("rose");
    expect(annotationForPage(2).dataset.annotationColor).toBe("rose");
  });

  it.each([
    ["com sessao ativa", false],
    ["sem sessao ativa", true],
  ])("bloqueia o double-click de retry %s", async (_scenario, closeSession) => {
    databaseMocks.createAnnotation.mockRejectedValueOnce(new Error("falha inicial"));
    await mountReader(1);
    act(() => click(getElement('[data-testid="apply-amber"]')));
    await waitFor(() => expect(getElement("[data-retry-id]")).toBeTruthy());

    if (closeSession) {
      act(() => click(getElement('[data-testid="annotate"]')));
    }

    const retryWrite = deferred<Annotation>();
    databaseMocks.createAnnotation.mockImplementationOnce(() => retryWrite.promise);
    const retryButton = getElement("[data-retry-id]");
    act(() => {
      click(retryButton);
      click(retryButton);
    });

    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2));
    const retryPayload = databaseMocks.createAnnotation.mock.calls[1][0] as NewAnnotation;
    retryWrite.resolve(savedAnnotation(retryPayload));
    await waitFor(() => expect(annotationForPage(1).dataset.saveState).toBe("saved"));
    expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2);
  });

  it("libera a guarda depois de uma falha para permitir novo retry manual", async () => {
    databaseMocks.createAnnotation
      .mockRejectedValueOnce(new Error("falha inicial"))
      .mockRejectedValueOnce(new Error("falha no primeiro retry"))
      .mockImplementationOnce(async (payload: NewAnnotation) => savedAnnotation(payload));
    await mountReader(1);
    act(() => click(getElement('[data-testid="apply-amber"]')));
    await waitFor(() => expect(getElement("[data-retry-id]")).toBeTruthy());

    act(() => click(getElement("[data-retry-id]")));
    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });
    act(() => click(getElement("[data-retry-id]")));

    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(annotationForPage(1).dataset.saveState).toBe("saved"));
  });

  it("reverte a UI para a ultima marcacao persistida quando o UPDATE falha", async () => {
    await mountReader(1);
    act(() => click(getElement('[data-testid="apply-amber"]')));
    await waitFor(() => expect(databaseMocks.createAnnotation).toHaveBeenCalledTimes(1));
    databaseMocks.updateAnnotationMark.mockRejectedValueOnce(new Error("falha no update"));

    act(() => click(getElement('[data-testid="apply-blue"]')));
    expect(annotationForPage(1).dataset.annotationColor).toBe("blue");

    await waitFor(() => expect(annotationForPage(1).dataset.annotationColor).toBe("amber"));
    expect(annotationForPage(1).dataset.annotationStyle).toBe("highlight");
    expect(databaseMocks.updateAnnotationMark).toHaveBeenCalledWith(
      "saved-1",
      "highlight",
      "blue",
      "loaded",
    );
  });
});
