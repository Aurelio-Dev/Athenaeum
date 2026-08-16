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
});
