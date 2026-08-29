// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InfoDialog } from "./InfoDialog";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("InfoDialog", () => {
  it("renderiza apenas a acao de dispensa e a chama no clique", () => {
    const onDismiss = vi.fn();

    act(() => {
      root?.render(
        <InfoDialog
          title="Titulo"
          message="Mensagem"
          onDismiss={onDismiss}
        />,
      );
    });

    const buttons = Array.from(container?.querySelectorAll("button") ?? []);
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.textContent).toBe("Entendi");

    act(() => buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
