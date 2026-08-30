// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NIGHT_LIGHT_MAX_OVERLAY_OPACITY } from "../lib/nightLight";
import { NightLightLayer, NIGHT_LIGHT_LAYER_CLASS_NAME } from "./NightLightLayer";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  container.dataset.testRoot = "true";
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(active: boolean, strength: number) {
  act(() => {
    root.render(<NightLightLayer active={active} strength={strength} />);
  });
}

function getLayer() {
  return document.body.querySelector<HTMLElement>(`.${NIGHT_LIGHT_LAYER_CLASS_NAME}`);
}

describe("NightLightLayer", () => {
  it("nao cria camada quando esta inativa", () => {
    render(false, 100);

    expect(getLayer()).toBeNull();
  });

  it("nao cria camada quando a forca efetiva e zero", () => {
    render(true, 0);
    expect(getLayer()).toBeNull();

    render(true, -20);
    expect(getLayer()).toBeNull();
  });

  it("cria um portal no body sem interceptar interacao", () => {
    render(true, 50);

    const layer = getLayer();
    expect(layer).not.toBeNull();
    expect(layer?.parentElement).toBe(document.body);
    expect(container.contains(layer)).toBe(false);
    expect(layer?.getAttribute("aria-hidden")).toBe("true");
    expect(layer?.style.position).toBe("fixed");
    expect(layer?.style.inset).toBe("0px");
    expect(layer?.style.pointerEvents).toBe("none");
    expect(Number(layer?.style.zIndex)).toBeGreaterThan(10_000);
    expect(layer?.style.mixBlendMode).toBe("multiply");
    expect(layer?.style.backgroundColor).toBe("rgba(255, 149, 46, 0.26)");
  });

  it("limita a opacidade visual ao teto calibrado", () => {
    render(true, 500);

    expect(getLayer()?.style.backgroundColor).toBe(
      `rgba(255, 149, 46, ${NIGHT_LIGHT_MAX_OVERLAY_OPACITY})`,
    );
  });

  it("remove imediatamente o portal ao desativar", () => {
    render(true, 80);
    expect(getLayer()).not.toBeNull();

    render(false, 80);
    expect(getLayer()).toBeNull();
  });

  it("exibe no maximo uma camada ao atualizar a forca", () => {
    render(true, 20);
    render(true, 75);

    expect(document.body.querySelectorAll(`.${NIGHT_LIGHT_LAYER_CLASS_NAME}`)).toHaveLength(1);
    expect(getLayer()?.style.backgroundColor).toBe("rgba(255, 149, 46, 0.39)");
  });
});
