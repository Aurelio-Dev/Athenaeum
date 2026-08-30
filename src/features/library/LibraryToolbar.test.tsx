// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryToolbar } from "./LibraryToolbar";

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

describe("LibraryToolbar", () => {
  it("usa o rotulo contextual da ordenacao recente sem alterar o sortMode", async () => {
    const onSortModeChange = vi.fn();

    await act(async () => {
      root.render(
        <LibraryToolbar
          chrome="docked"
          sortMode="recentes"
          viewMode="grid"
          recentSortLabel="Aberto recentemente"
          onSortModeChange={onSortModeChange}
          onViewModeChange={vi.fn()}
        />,
      );
    });

    const trigger = container.querySelector("button");
    expect(trigger?.textContent).toContain("Aberto recentemente");

    act(() => trigger?.click());
    const recentOption = Array.from(container.querySelectorAll("button")).find(
      (button) => button !== trigger && button.textContent?.trim() === "Aberto recentemente",
    );
    act(() => recentOption?.click());

    expect(onSortModeChange).toHaveBeenCalledWith("recentes");
  });

  it("delega o backdrop ao dropdown somente quando a barra nao gera caixa", async () => {
    const renderToolbar = (chrome: "docked" | "floating") => {
      root.render(
        <LibraryToolbar
          chrome={chrome}
          sortMode="recentes"
          viewMode="grid"
          onSortModeChange={vi.fn()}
          onViewModeChange={vi.fn()}
        />,
      );
    };

    await act(async () => renderToolbar("docked"));
    const trigger = container.querySelector<HTMLButtonElement>("button");
    act(() => trigger?.click());
    expect(container.querySelector(".material-liquid-overlay")?.getAttribute("data-glass-backdrop"))
      .toBeNull();

    act(() => trigger?.click());
    await act(async () => renderToolbar("floating"));
    act(() => trigger?.click());
    expect(container.querySelector(".material-liquid-overlay")?.getAttribute("data-glass-backdrop"))
      .toBe("optical");
  });
});
