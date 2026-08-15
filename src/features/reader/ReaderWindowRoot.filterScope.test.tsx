// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryDocument } from "../../types/library";
import { ReaderWindowRoot } from "./ReaderWindowRoot";

const eventMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  return {
    handlers,
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
  getDocumentNotes: vi.fn(async () => ""),
  getLibraryDocument: databaseMocks.getLibraryDocument,
  getReaderOpensMaximized: vi.fn(async () => true),
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
  READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT: "reader:annotations-filter-scope-changed",
  READER_SWITCH_DOCUMENT_EVENT: "reader-window:switch-document",
  setDocumentAnnotationsFilterScope: databaseMocks.setDocumentAnnotationsFilterScope,
  setDocumentFavorite: vi.fn(async () => undefined),
  setDocumentNote: vi.fn(async () => undefined),
  setDocumentReadingLocation: vi.fn(async () => undefined),
  setDocumentReadingStarted: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
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

vi.mock("../../hooks/useTheme", async () => {
  const { createElement } = await import("react");
  return {
    ThemeProvider: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
  };
});

vi.mock("./ReaderContent", async () => {
  const { createElement } = await import("react");
  return {
    ReaderContent: ({ document }: { document: LibraryDocument }) => createElement(
      "output",
      { "data-testid": "filter-scope" },
      document.annotationsFilterScope,
    ),
  };
});

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

async function renderReaderWindow() {
  await act(async () => {
    root?.render(<ReaderWindowRoot documentId="document-1" />);
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

describe("ReaderWindowRoot - sincronizacao do filtro de anotacoes", () => {
  it("atualiza somente o documento atual sem persistir novamente", async () => {
    await renderReaderWindow();
    expect(container?.querySelector('[data-testid="filter-scope"]')?.textContent).toBe("all");

    dispatchFilterScope({ documentId: "outro-documento", scope: "current_page", origin: "reader-annotations-panel" });
    expect(container?.querySelector('[data-testid="filter-scope"]')?.textContent).toBe("all");

    dispatchFilterScope({ documentId: "document-1", scope: "current_page", origin: "reader-annotations-panel" });
    expect(container?.querySelector('[data-testid="filter-scope"]')?.textContent).toBe("current_page");
    expect(databaseMocks.setDocumentAnnotationsFilterScope).not.toHaveBeenCalled();
  });
});
