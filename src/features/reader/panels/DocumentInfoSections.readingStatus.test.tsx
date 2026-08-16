// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingStatusCard } from "./DocumentInfoSections";

const databaseMocks = vi.hoisted(() => ({
  updateDocumentReadingStatus: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));

vi.mock("../../../lib/database", () => ({
  addDocumentTag: vi.fn(),
  isReaderInvalidationPayload: vi.fn(),
  listAvailableTags: vi.fn(),
  listAvailableTagsFromPreloadedDatabase: vi.fn(),
  listRelatedDocuments: vi.fn(),
  openDocumentExternally: vi.fn(),
  READER_DETAILS_CHANGED_EVENT: "reader:details-changed",
  removeDocumentTag: vi.fn(),
  updateDocumentReadingStatus: databaseMocks.updateDocumentReadingStatus,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  databaseMocks.updateDocumentReadingStatus.mockReset();
  databaseMocks.updateDocumentReadingStatus.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function getStatusButton(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  );

  if (!button) {
    throw new Error(`Botao de status nao encontrado: ${label}`);
  }

  return button;
}

describe("ReadingStatusCard", () => {
  it("reflete otimisticamente e bloqueia escrita concorrente", async () => {
    let resolveUpdate: (() => void) | undefined;
    databaseMocks.updateDocumentReadingStatus.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <ReadingStatusCard
          documentId="document-1"
          status="not-started"
          progress={0}
          databaseSource="preloaded"
          variant="island"
        />,
      );
    });

    act(() => getStatusButton("Concluído").click());

    expect(getStatusButton("Concluído").getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(container.querySelectorAll("button")).every((button) => button.disabled)).toBe(true);
    expect(databaseMocks.updateDocumentReadingStatus).toHaveBeenCalledWith(
      "document-1",
      "completed",
      "preloaded",
    );

    await act(async () => resolveUpdate?.());
    expect(Array.from(container.querySelectorAll("button")).every((button) => !button.disabled)).toBe(true);
  });

  it("nao libera escrita nem sobrescreve a escolha enquanto a prop muda", async () => {
    let resolveUpdate: (() => void) | undefined;
    databaseMocks.updateDocumentReadingStatus.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpdate = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <ReadingStatusCard documentId="document-1" status="in-progress" progress={25} variant="island" />,
      );
    });
    act(() => getStatusButton("Concluído").click());

    await act(async () => {
      root.render(
        <ReadingStatusCard documentId="document-1" status="not-started" progress={25} variant="island" />,
      );
    });

    expect(getStatusButton("Concluído").getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(container.querySelectorAll("button")).every((button) => button.disabled)).toBe(true);

    await act(async () => {
      root.render(
        <ReadingStatusCard documentId="document-1" status="completed" progress={25} variant="island" />,
      );
      resolveUpdate?.();
    });

    expect(getStatusButton("Concluído").getAttribute("aria-pressed")).toBe("true");
    expect(Array.from(container.querySelectorAll("button")).every((button) => !button.disabled)).toBe(true);
  });

  it("restaura o status anterior quando a escrita falha", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    databaseMocks.updateDocumentReadingStatus.mockRejectedValueOnce(new Error("falha"));

    await act(async () => {
      root.render(
        <ReadingStatusCard documentId="document-1" status="in-progress" progress={25} variant="island" />,
      );
    });
    await act(async () => getStatusButton("Concluído").click());

    expect(getStatusButton("Em andamento").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível atualizar o status de leitura.",
    );
    warn.mockRestore();
  });

  it("reseta o estado local ao trocar de documento", async () => {
    let resolveFirstDocumentUpdate: (() => void) | undefined;
    databaseMocks.updateDocumentReadingStatus.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveFirstDocumentUpdate = resolve;
      }),
    );

    await act(async () => {
      root.render(
        <ReadingStatusCard documentId="document-1" status="not-started" progress={0} variant="island" />,
      );
    });
    act(() => getStatusButton("Em andamento").click());
    expect(getStatusButton("Em andamento").getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      root.render(
        <ReadingStatusCard documentId="document-2" status="completed" progress={80} variant="island" />,
      );
    });

    expect(getStatusButton("Concluído").getAttribute("aria-pressed")).toBe("true");
    expect(container.textContent).toContain("80%");

    await act(async () => resolveFirstDocumentUpdate?.());
    expect(getStatusButton("Concluído").getAttribute("aria-pressed")).toBe("true");
  });
});
