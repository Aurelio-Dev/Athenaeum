// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryDocument } from "../../types/library";
import { ReaderPanelPopout } from "./ReaderPanelPopout";

const eventMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  return {
    handlers,
    emit: vi.fn(async () => undefined),
    emitTo: vi.fn(async () => undefined),
    listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(eventName, handler);
      return () => handlers.delete(eventName);
    }),
  };
});

const databaseMocks = vi.hoisted(() => ({
  getLibraryDocument: vi.fn(),
  setDocumentAnnotationsFilterScope: vi.fn(),
}));

const filterScopeEvent = "reader:annotations-filter-scope-changed";

vi.mock("../../lib/database", () => ({
  deleteAnnotation: vi.fn(async () => undefined),
  getDocumentNotes: vi.fn(async () => ""),
  getLibraryDocument: databaseMocks.getLibraryDocument,
  isReaderAnnotationsFilterScopeChangedPayload: (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) {
      return false;
    }
    const candidate = payload as Record<string, unknown>;
    return (
      typeof candidate.documentId === "string" &&
      typeof candidate.origin === "string" &&
      (candidate.scope === "all" || candidate.scope === "current_page")
    );
  },
  isReaderDocumentPayload: vi.fn(() => false),
  isReaderInvalidationPayload: vi.fn(() => false),
  isReaderPageStatePayload: vi.fn(() => false),
  listAnnotations: vi.fn(async () => []),
  listAvailableTagsFromPreloadedDatabase: vi.fn(async () => []),
  READER_ANNOTATIONS_CHANGED_EVENT: "reader:annotations-changed",
  READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT: "reader:annotations-filter-scope-changed",
  READER_DETAILS_CHANGED_EVENT: "reader:details-changed",
  READER_JUMP_TO_PAGE_EVENT: "reader:jump-to-page",
  READER_NOTES_CHANGED_EVENT: "reader:notes-changed",
  READER_PAGE_STATE_CHANGED_EVENT: "reader:page-state-changed",
  READER_PAGE_STATE_REQUESTED_EVENT: "reader:page-state-requested",
  READER_POPOUT_CLOSED_EVENT: "reader:popout-closed",
  READER_POPOUT_STATUS_CHANGED_EVENT: "reader:popout-status-changed",
  READER_POPOUT_STATUS_REQUESTED_EVENT: "reader:popout-status-requested",
  READER_SET_DOCUMENT_EVENT: "reader:set-document",
  READER_WINDOW_LABEL: "reader-window",
  setDocumentAnnotationsFilterScope: databaseMocks.setDocumentAnnotationsFilterScope,
  setDocumentNote: vi.fn(async () => undefined),
  updateAnnotationNote: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: eventMocks.emit,
  emitTo: eventMocks.emitTo,
  listen: eventMocks.listen,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: vi.fn(async () => () => undefined),
  }),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "reader-annotations-panel" }),
}));

vi.mock("./panels/AnnotationsTab", async () => {
  const { createElement } = await import("react");
  return {
    AnnotationsTab: ({ document }: { document: LibraryDocument }) => createElement(
      "output",
      { "data-testid": "filter-scope" },
      document.annotationsFilterScope,
    ),
  };
});

vi.mock("./panels/AiTab", () => ({ AiTab: () => null }));

const testDocument: LibraryDocument = {
  id: "document-1",
  title: "Documento de teste",
  description: "",
  authors: [],
  source: "",
  year: 2026,
  tags: [],
  status: "in-progress",
  progress: 20,
  favorite: false,
  collection: "Sem colecao",
  updatedAt: "2026-08-15T12:00:00.000Z",
  annotationsFilterScope: "all",
  notes: "",
  timeSpentSeconds: 0,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderPopout() {
  await act(async () => {
    root?.render(<ReaderPanelPopout documentId="document-1" />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

function dispatchFilterScope(payload: unknown) {
  const handler = eventMocks.handlers.get(filterScopeEvent);
  if (!handler) {
    throw new Error("Listener do filtro de anotacoes nao registrado.");
  }
  act(() => handler({ payload }));
}

beforeEach(() => {
  eventMocks.handlers.clear();
  eventMocks.emit.mockClear();
  eventMocks.emitTo.mockClear();
  eventMocks.listen.mockClear();
  databaseMocks.getLibraryDocument.mockReset();
  databaseMocks.getLibraryDocument.mockResolvedValue(testDocument);
  databaseMocks.setDocumentAnnotationsFilterScope.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe("ReaderPanelPopout - sincronizacao do filtro de anotacoes", () => {
  it("atualiza somente o documento aberto sem persistir novamente", async () => {
    await renderPopout();
    expect(container?.querySelector('[data-testid="filter-scope"]')?.textContent).toBe("all");

    dispatchFilterScope({ documentId: "outro-documento", scope: "current_page", origin: "reader-window" });
    expect(container?.querySelector('[data-testid="filter-scope"]')?.textContent).toBe("all");

    dispatchFilterScope({ documentId: "document-1", scope: "current_page", origin: "reader-window" });
    expect(container?.querySelector('[data-testid="filter-scope"]')?.textContent).toBe("current_page");
    expect(databaseMocks.setDocumentAnnotationsFilterScope).not.toHaveBeenCalled();
  });
});
