import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  get: vi.fn(),
  load: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    get: databaseMocks.get,
    load: databaseMocks.load,
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: eventMocks.emit,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "reader-window" }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  isReaderJumpToPagePayload,
  isReaderPageStatePayload,
  READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT,
  setDocumentAnnotationsFilterScope,
} from "./database";

beforeEach(() => {
  databaseMocks.execute.mockReset();
  databaseMocks.execute.mockResolvedValue({ rowsAffected: 1 });
  databaseMocks.get.mockReturnValue({ execute: databaseMocks.execute });
  eventMocks.emit.mockReset();
  eventMocks.emit.mockResolvedValue(undefined);
});

describe("eventos do filtro de anotacoes", () => {
  it("emite o novo escopo depois de persistir a preferencia", async () => {
    await setDocumentAnnotationsFilterScope("document-1", "current_page", "preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith(
      "UPDATE documents SET annotations_filter_scope = $1 WHERE id = $2",
      ["current_page", "document-1"],
    );
    expect(eventMocks.emit).toHaveBeenCalledTimes(1);
    expect(eventMocks.emit).toHaveBeenCalledWith(
      READER_ANNOTATIONS_FILTER_SCOPE_CHANGED_EVENT,
      {
        documentId: "document-1",
        scope: "current_page",
        origin: "reader-window",
      },
    );
    expect(databaseMocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
      eventMocks.emit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("nao emite quando o UPDATE falha", async () => {
    databaseMocks.execute.mockRejectedValueOnce(new Error("falha no SQLite"));

    await expect(
      setDocumentAnnotationsFilterScope("document-1", "all", "preloaded"),
    ).rejects.toThrow("falha no SQLite");

    expect(eventMocks.emit).not.toHaveBeenCalled();
  });
});

describe("payload de navegacao do Reader", () => {
  it("aceita emissões legadas sem annotationId e as novas com annotationId", () => {
    expect(isReaderJumpToPagePayload({ documentId: "document-1", page: 2 })).toBe(true);
    expect(isReaderJumpToPagePayload({ documentId: "document-1", page: 2, annotationId: "annotation-2" })).toBe(true);
    expect(isReaderJumpToPagePayload({ documentId: "document-1", page: 2, annotationId: 2 })).toBe(false);
  });

  it("exige o booleano de seleção no estado sincronizado da página", () => {
    const validPayload = {
      documentId: "document-1",
      page: 2,
      progress: 40,
      totalPages: 5,
      fileSizeBytes: 1024,
      hasSelection: true,
    };

    expect(isReaderPageStatePayload(validPayload)).toBe(true);
    expect(isReaderPageStatePayload({ ...validPayload, hasSelection: false })).toBe(true);
    expect(isReaderPageStatePayload({ ...validPayload, hasSelection: "sim" })).toBe(false);
    expect(isReaderPageStatePayload({
      documentId: validPayload.documentId,
      page: validPayload.page,
      progress: validPayload.progress,
      totalPages: validPayload.totalPages,
      fileSizeBytes: validPayload.fileSizeBytes,
    })).toBe(false);
  });
});
