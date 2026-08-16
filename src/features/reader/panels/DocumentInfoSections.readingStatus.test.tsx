// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingStatusCard } from "./DocumentInfoSections";
import type { DocumentStatus } from "../../../types/library";

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
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

// Espelha o ReaderWindowRoot: a prop `status` so avanca depois que a escrita
// resolve. Se a escrita rejeita, o estado do host nao e tocado.
function ControlledStatusCard({
  initialStatus,
  writeStatus,
}: {
  initialStatus: DocumentStatus;
  writeStatus: (status: DocumentStatus) => Promise<void>;
}) {
  const [status, setStatus] = useState<DocumentStatus>(initialStatus);

  return (
    <ReadingStatusCard
      status={status}
      progress={25}
      variant="island"
      onUpdateReadingStatus={async (nextStatus) => {
        await writeStatus(nextStatus);
        setStatus(nextStatus);
      }}
    />
  );
}

function getPill() {
  const pill = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  if (!pill) {
    throw new Error("Pilula de status nao encontrada.");
  }
  return pill;
}

function getPillLabel() {
  return getPill().textContent?.trim() ?? "";
}

function queryMenuItems() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'));
}

function getMenuItem(label: string) {
  const item = queryMenuItems().find((candidate) => candidate.textContent?.trim() === label);
  if (!item) {
    throw new Error(`Opcao de status nao encontrada: ${label}`);
  }
  return item;
}

function openMenu() {
  act(() => getPill().click());
}

async function renderControlled(
  initialStatus: DocumentStatus,
  writeStatus: (status: DocumentStatus) => Promise<void>,
) {
  await act(async () => {
    root.render(<ControlledStatusCard initialStatus={initialStatus} writeStatus={writeStatus} />);
  });
}

describe("ReadingStatusCard", () => {
  it("reflete o novo status apos a escrita, sem re-render manual com prop nova", async () => {
    const writeStatus = vi.fn(async () => undefined);
    await renderControlled("in-progress", writeStatus);

    expect(getPillLabel()).toBe("Em andamento");

    openMenu();
    await act(async () => getMenuItem("Concluído").click());

    expect(writeStatus).toHaveBeenCalledWith("completed");
    expect(getPillLabel()).toBe("Concluído");
    expect(queryMenuItems()).toHaveLength(0);
  });

  it("nao antecipa a escolha enquanto a escrita esta pendente", async () => {
    let resolveWrite: (() => void) | undefined;
    const writeStatus = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    await renderControlled("in-progress", writeStatus);

    openMenu();
    act(() => getMenuItem("Concluído").click());

    // O card e controlado: ate a escrita confirmar, a fonte de verdade ainda
    // diz "Em andamento" e e isso que precisa aparecer.
    expect(getPillLabel()).toBe("Em andamento");
    expect(getPill().disabled).toBe(true);

    await act(async () => resolveWrite?.());

    expect(getPillLabel()).toBe("Concluído");
    expect(getPill().disabled).toBe(false);
    expect(writeStatus).toHaveBeenCalledTimes(1);
  });

  it("mantem o status persistido e avisa quando a escrita falha", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const writeStatus = vi.fn(async () => {
      throw new Error("falha");
    });
    await renderControlled("in-progress", writeStatus);

    openMenu();
    await act(async () => getMenuItem("Concluído").click());

    expect(getPillLabel()).toBe("Em andamento");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Não foi possível atualizar o status de leitura.",
    );
    expect(getPill().disabled).toBe(false);
    warn.mockRestore();
  });

  it("nao oferece \"Não iniciado\" como opcao selecionavel", async () => {
    await renderControlled("not-started", vi.fn(async () => undefined));

    openMenu();
    const labels = queryMenuItems().map((item) => item.textContent?.trim());

    expect(labels).toEqual(["Em andamento", "Concluído"]);
    expect(labels).not.toContain("Não iniciado");
  });

  it("exibe \"Não iniciado\" quando e o status atual do documento", async () => {
    await renderControlled("not-started", vi.fn(async () => undefined));

    expect(getPillLabel()).toBe("Não iniciado");
    expect(getPill().getAttribute("aria-label")).toBe("Status de leitura: Não iniciado. Alterar.");
  });

  it("marca a opcao correspondente ao status atual", async () => {
    await renderControlled("completed", vi.fn(async () => undefined));

    openMenu();

    expect(getMenuItem("Concluído").getAttribute("aria-checked")).toBe("true");
    expect(getMenuItem("Em andamento").getAttribute("aria-checked")).toBe("false");
  });

  it("abre e fecha o menu pela pilula e preserva o percentual", async () => {
    await renderControlled("in-progress", vi.fn(async () => undefined));

    expect(container.textContent).toContain("25%");
    expect(queryMenuItems()).toHaveLength(0);

    openMenu();
    expect(getPill().getAttribute("aria-expanded")).toBe("true");
    expect(queryMenuItems()).toHaveLength(2);

    openMenu();
    expect(getPill().getAttribute("aria-expanded")).toBe("false");
    expect(queryMenuItems()).toHaveLength(0);
  });
});
