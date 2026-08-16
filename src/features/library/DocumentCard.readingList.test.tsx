// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryDocument, LibraryRoute, ViewMode } from "../../types/library";
import { DocumentCard } from "./DocumentCard";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const documentFixture: LibraryDocument = {
  id: "document-1",
  title: "Documento de teste",
  description: "",
  authors: ["Autora"],
  source: "Fonte",
  year: 2026,
  tags: [],
  status: "in-progress",
  progress: 25,
  favorite: false,
  collection: "Colecao",
  updatedAt: "2026-08-16T00:00:00.000Z",
  annotationsFilterScope: "all",
  timeSpentSeconds: 0,
};

const routesOutsideReadingList: Array<{ label: string; route: LibraryRoute }> = [
  { label: "todos os itens", route: { type: "all" } },
  { label: "recentes", route: { type: "recent" } },
  { label: "favoritos", route: { type: "favorites" } },
  { label: "colecao", route: { type: "collection", collectionName: "Colecao" } },
  { label: "lixeira", route: { type: "trash" } },
];

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

async function renderAndOpenMenu(route: LibraryRoute, viewMode: ViewMode, onDismiss = vi.fn()) {
  await act(async () => {
    root.render(
      <DocumentCard
        activeRoute={route}
        document={documentFixture}
        isSelected={false}
        viewMode={viewMode}
        collections={[]}
        onSelect={vi.fn()}
        onOpenDetails={vi.fn()}
        onToggleFavorite={vi.fn()}
        onMoveToCollection={vi.fn()}
        onDismissFromReadingList={onDismiss}
        onDelete={vi.fn()}
      />,
    );
  });

  const card = container.querySelector("article");
  if (!card) {
    throw new Error("Card de documento nao encontrado.");
  }

  await act(async () => {
    card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }));
  });

  return onDismiss;
}

function getDismissButton() {
  return Array.from(document.body.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Dispensar",
  );
}

describe("menu de contexto do documento em Em andamento", () => {
  it.each<ViewMode>(["grid", "list"])("exibe e executa Dispensar na visualizacao %s", async (viewMode) => {
    const onDismiss = await renderAndOpenMenu({ type: "reading-list" }, viewMode);
    const dismissButton = getDismissButton();

    expect(dismissButton).toBeDefined();
    act(() => dismissButton?.click());
    expect(onDismiss).toHaveBeenCalledWith("document-1");
  });

  it.each(routesOutsideReadingList)("nao renderiza Dispensar na rota $label", async ({ route }) => {
    await renderAndOpenMenu(route, "grid");

    expect(getDismissButton()).toBeUndefined();
  });
});
