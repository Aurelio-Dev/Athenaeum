import type Database from "@tauri-apps/plugin-sql";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentStatus } from "../types/library";

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
  listDocuments,
  READER_PROGRESS_CHANGED_EVENT,
  setDocumentReadingStarted,
  updateDocumentReadingStatus,
} from "./database";

beforeEach(() => {
  databaseMocks.execute.mockReset();
  databaseMocks.execute.mockResolvedValue({ rowsAffected: 1 });
  databaseMocks.get.mockReturnValue({ execute: databaseMocks.execute });
  databaseMocks.load.mockReset();
  eventMocks.emit.mockReset();
  eventMocks.emit.mockResolvedValue(undefined);
});

describe("inicio da leitura", () => {
  it("atualiza a ultima abertura sem forcar progresso", async () => {
    await setDocumentReadingStarted("document-1", "preloaded");

    const [sql, bindValues] = databaseMocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("last_opened_at = strftime");
    expect(sql).toContain("status = CASE WHEN status = 'not-started' THEN 'in-progress' ELSE status END");
    expect(sql).not.toMatch(/\bprogress\s*=/);
    expect(bindValues).toEqual(["document-1"]);
  });

  it("preserva completed quando o documento e reaberto", async () => {
    await setDocumentReadingStarted("document-completed", "preloaded");

    const [sql] = databaseMocks.execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("CASE WHEN status = 'not-started' THEN 'in-progress' ELSE status END");
    expect(sql).not.toContain("WHERE id = $1 AND deleted_at IS NULL AND status = 'not-started'");
  });
});

describe("atualizacao manual do status de leitura", () => {
  it.each<DocumentStatus>(["not-started", "in-progress", "completed"])(
    "persiste e emite invalidacao para %s",
    async (status) => {
      await updateDocumentReadingStatus("document-1", status, "preloaded");

      expect(databaseMocks.execute).toHaveBeenCalledWith(
        expect.stringContaining("SET status = $1, updated_at = strftime"),
        [status, "document-1"],
      );
      expect(eventMocks.emit).toHaveBeenCalledWith(READER_PROGRESS_CHANGED_EVENT, {
        documentId: "document-1",
        origin: "reader-window",
      });
      expect(databaseMocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
        eventMocks.emit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
      );
    },
  );

  it("falha fechada para um status futuro desconhecido", async () => {
    const futureStatus = "paused" as DocumentStatus;

    await expect(updateDocumentReadingStatus("document-1", futureStatus, "preloaded")).rejects.toThrow(
      "Status de leitura invalido.",
    );

    expect(databaseMocks.execute).not.toHaveBeenCalled();
    expect(eventMocks.emit).not.toHaveBeenCalled();
  });

  it("nao emite invalidacao quando o UPDATE falha", async () => {
    databaseMocks.execute.mockRejectedValueOnce(new Error("falha no SQLite"));

    await expect(
      updateDocumentReadingStatus("document-1", "completed", "preloaded"),
    ).rejects.toThrow("falha no SQLite");

    expect(eventMocks.emit).not.toHaveBeenCalled();
  });

  it("falha e nao emite invalidacao quando nenhuma linha e atualizada", async () => {
    databaseMocks.execute.mockResolvedValueOnce({ rowsAffected: 0 });

    await expect(
      updateDocumentReadingStatus("document-na-lixeira", "completed", "preloaded"),
    ).rejects.toThrow("Documento nao encontrado para atualizar o status de leitura.");

    expect(eventMocks.emit).not.toHaveBeenCalled();
  });
});

describe("query da Reading List", () => {
  async function getQuery(sortMode: "recentes" | "titulo" | "progresso") {
    const select = vi.fn().mockResolvedValue([]);
    const database = { select } as unknown as Database;

    await listDocuments(database, {
      searchTerm: "",
      sortMode,
      route: { type: "reading-list" },
    });

    return (select.mock.calls[0] as [string, unknown[]])[0];
  }

  it("filtra status ativo e itens nao dispensados desde a ultima abertura", async () => {
    const sql = await getQuery("recentes");

    expect(sql).toContain("documents.status = 'in-progress'");
    expect(sql).toContain("documents.reading_list_dismissed_at IS NULL");
    expect(sql).toContain("documents.last_opened_at > documents.reading_list_dismissed_at");
  });

  it("ordena a opcao recentes pela ultima abertura, com NULL no fim", async () => {
    const sql = await getQuery("recentes");

    expect(sql).toContain(
      "ORDER BY documents.last_opened_at IS NULL, documents.last_opened_at DESC",
    );
  });

  it("preserva a precedencia das ordenacoes explicitas", async () => {
    const titleSql = await getQuery("titulo");
    const progressSql = await getQuery("progresso");

    expect(titleSql).toContain("ORDER BY documents.title COLLATE NOCASE ASC");
    expect(progressSql).toContain("ORDER BY documents.progress DESC, documents.updated_at DESC");
  });
});
