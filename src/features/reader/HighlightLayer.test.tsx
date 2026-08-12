// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Annotation, AnnotationSaveState } from "../../types/annotation";
import { HighlightLayer } from "./HighlightLayer";

const baseAnnotation: Annotation = {
  id: "annotation-1",
  documentId: "document-1",
  page: 1,
  markStyle: "highlight",
  color: "blue",
  selectedText: "Texto selecionado",
  note: "",
  rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.04 }],
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-12T00:00:00.000Z",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function renderLayer(
  annotation: Annotation,
  saveStates = new Map<string, AnnotationSaveState>(),
  onRetry = vi.fn(),
  onSelect = vi.fn(),
) {
  act(() => {
    root?.render(
      <HighlightLayer
        annotations={[annotation]}
        saveStates={saveStates}
        onRetry={onRetry}
        onSelect={onSelect}
      />,
    );
  });

  return { onRetry, onSelect };
}

function annotationRect() {
  const element = container?.querySelector<HTMLButtonElement>('button[aria-label="Abrir anotacao"]');
  if (!element) {
    throw new Error("Retangulo da anotacao nao encontrado.");
  }
  return element;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container = null;
  document.body.replaceChildren();
});

describe("HighlightLayer", () => {
  it("mantem fundo e opacidade para highlight", () => {
    const { onSelect } = renderLayer(baseAnnotation);
    const rect = annotationRect();

    expect(rect.style.left).toBe("10%");
    expect(rect.style.top).toBe("20%");
    expect(rect.style.width).toBe("30%");
    expect(rect.style.height).toBe("4%");
    expect(rect.style.backgroundColor).toBe("rgb(29, 78, 216)");
    expect(rect.style.opacity).toBe("0.3");
    expect(rect.style.borderBottom).toBe("");

    act(() => rect.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith(baseAnnotation);
  });

  it("desenha underline sem fundo e preserva retry e clique", () => {
    const underlineAnnotation: Annotation = { ...baseAnnotation, markStyle: "underline" };
    const saveStates = new Map<string, AnnotationSaveState>([[underlineAnnotation.id, "unsaved"]]);
    const { onRetry, onSelect } = renderLayer(underlineAnnotation, saveStates);
    const rect = annotationRect();

    expect(rect.style.backgroundColor).toBe("transparent");
    expect(rect.style.borderBottom).toBe("2px solid rgb(29, 78, 216)");
    expect(rect.style.opacity).toBe("");

    act(() => rect.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelect).toHaveBeenCalledWith(underlineAnnotation);

    const retry = Array.from(container?.querySelectorAll("button") ?? []).find((element) => (
      element.textContent?.includes("Tentar novamente")
    ));
    expect(retry).toBeTruthy();
    act(() => retry?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRetry).toHaveBeenCalledWith(underlineAnnotation.id);
  });
});
