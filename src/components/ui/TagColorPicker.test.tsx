// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TagColorPicker } from "./TagColorPicker";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("TagColorPicker", () => {
  it("coloca remover cor como o decimo e ultimo swatch da grade compacta", () => {
    const onRemove = vi.fn();
    act(() => {
      root.render(
        <TagColorPicker
          compact
          selectedToken="amber"
          onSelect={vi.fn()}
          onRemove={onRemove}
        />,
      );
    });

    const grid = container.firstElementChild;
    const buttons = Array.from(container.querySelectorAll("button"));
    const removeButton = buttons[buttons.length - 1];

    expect(grid?.classList.contains("grid-cols-5")).toBe(true);
    expect(buttons).toHaveLength(10);
    expect(removeButton?.getAttribute("aria-label")).toBe("Remover cor");
    expect(removeButton?.getAttribute("type")).toBe("button");
    expect(removeButton?.classList.contains("focus-visible:ring-2")).toBe(true);

    removeButton?.focus();
    expect(document.activeElement).toBe(removeButton);
    act(() => removeButton?.click());
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("nao oferece remocao quando a cor e obrigatoria", () => {
    act(() => {
      root.render(<TagColorPicker selectedToken="violet" onSelect={vi.fn()} />);
    });

    expect(container.querySelectorAll("button")).toHaveLength(9);
    expect(container.querySelector('button[aria-label="Remover cor"]')).toBeNull();
  });
});
