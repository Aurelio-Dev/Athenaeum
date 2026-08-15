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
