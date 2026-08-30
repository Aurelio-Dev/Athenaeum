// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KeyboardShortcutsSettings } from "./KeyboardShortcutsSettings";
import {
  resolveShortcutBindings,
  type ShortcutBinding,
  type ShortcutOverrides,
} from "../../lib/keyboardShortcuts";

const hookMocks = vi.hoisted(() => ({
  setShortcutBinding: vi.fn(),
  resetShortcutBinding: vi.fn(),
  resetAllShortcutBindings: vi.fn(),
  overrides: { current: {} as ShortcutOverrides },
}));

vi.mock("../../hooks/useKeyboardShortcuts", async () => {
  const real = await vi.importActual<typeof import("../../lib/keyboardShortcuts")>(
    "../../lib/keyboardShortcuts",
  );
  return {
    useKeyboardShortcuts: () => ({
      bindings: real.resolveShortcutBindings(hookMocks.overrides.current),
      overrides: hookMocks.overrides.current,
      matchesShortcut: () => false,
      setShortcutBinding: hookMocks.setShortcutBinding,
      resetShortcutBinding: hookMocks.resetShortcutBinding,
      resetAllShortcutBindings: hookMocks.resetAllShortcutBindings,
    }),
  };
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function render() {
  act(() => root?.render(<KeyboardShortcutsSettings />));
}

function linhaDe(acao: string): HTMLElement {
  const titulo = Array.from(container?.querySelectorAll("p") ?? []).find(
    (candidato) => candidato.textContent === acao,
  );
  const linha = titulo?.parentElement?.parentElement;
  if (!linha) throw new Error(`Linha nao encontrada: ${acao}`);
  return linha as HTMLElement;
}

function lapisDe(acao: string): HTMLButtonElement | null {
  return linhaDe(acao).querySelector<HTMLButtonElement>(
    `button[aria-label="Alterar o atalho: ${acao}"]`,
  );
}

function teclasDe(acao: string): string[] {
  return Array.from(linhaDe(acao).querySelectorAll("kbd")).map((tecla) => tecla.textContent ?? "");
}

function pressionar(key: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean }> = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key,
      ctrlKey: mods.ctrl ?? false,
      shiftKey: mods.shift ?? false,
      altKey: mods.alt ?? false,
      bubbles: true,
      cancelable: true,
    }));
  });
}

beforeEach(() => {
  hookMocks.setShortcutBinding.mockReset().mockReturnValue(null);
  hookMocks.resetShortcutBinding.mockReset();
  hookMocks.resetAllShortcutBindings.mockReset();
  hookMocks.overrides.current = {};
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

describe("edicao de atalhos em Ajustes", () => {
  it("oferece lapis so nos atalhos remapeaveis", () => {
    render();

    expect(lapisDe("Salvar agora")).not.toBeNull();
    expect(lapisDe("Selecionar")).not.toBeNull();
    expect(lapisDe("Alternar tela cheia")).not.toBeNull();
    // Fixos: navegacao e acoes com mais de uma tecla alternativa.
    expect(lapisDe("Avançar entre células da tabela")).toBeNull();
    expect(lapisDe("Remover elemento selecionado")).toBeNull();
    expect(lapisDe("Aumentar zoom")).toBeNull();
  });

  it("captura a nova combinacao e a entrega ao registro", () => {
    render();
    act(() => lapisDe("Salvar agora")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    pressionar("Control", { ctrl: true });
    expect(hookMocks.setShortcutBinding).not.toHaveBeenCalled();

    pressionar("k", { ctrl: true, shift: true });
    expect(hookMocks.setShortcutBinding).toHaveBeenCalledWith("notebook.save", {
      key: "k", ctrl: true, shift: true, alt: false,
    });
  });

  it("impede que o acorde capturado dispare o atalho real do app", () => {
    const espiao = vi.fn();
    window.addEventListener("keydown", espiao);
    render();
    act(() => lapisDe("Salvar agora")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    pressionar("s", { ctrl: true });

    // A captura roda na fase de captura e interrompe a propagacao: sem isso,
    // gravar Ctrl+S salvaria um Caderno aberto no mesmo instante.
    expect(espiao).not.toHaveBeenCalled();
    window.removeEventListener("keydown", espiao);
  });

  it("mostra o motivo da recusa e continua capturando", () => {
    hookMocks.setShortcutBinding.mockReturnValue({ reason: "conflict", conflictId: "canvas.tool-rectangle" });
    render();
    act(() => lapisDe("Selecionar")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    pressionar("r");

    expect(linhaDe("Selecionar").textContent).toContain("Já usado por “Retângulo”");
    expect(container?.textContent).toContain("Pressione a combinação");
  });

  it("cancela a captura no Escape sem gravar nada", () => {
    render();
    act(() => lapisDe("Selecionar")?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(container?.textContent).toContain("Pressione a combinação");

    pressionar("Escape");

    expect(hookMocks.setShortcutBinding).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("Pressione a combinação");
  });

  it("exibe o acorde personalizado e oferece restaurar so na linha alterada", () => {
    const personalizado: ShortcutBinding = { key: "j", ctrl: true, shift: false, alt: false };
    hookMocks.overrides.current = { "canvas.tool-select": personalizado };
    render();

    expect(teclasDe("Selecionar")).toEqual(["Ctrl", "J"]);
    expect(teclasDe("Retângulo")).toEqual(["R"]);
    expect(linhaDe("Selecionar").textContent).toContain("Restaurar padrão");
    expect(linhaDe("Retângulo").textContent).not.toContain("Restaurar padrão");
  });

  it("habilita restaurar todos apenas quando existe personalizacao", () => {
    render();
    const botao = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidato) => candidato.textContent === "Restaurar todos os atalhos",
    ) as HTMLButtonElement;
    expect(botao.disabled).toBe(true);

    hookMocks.overrides.current = {
      "canvas.tool-select": { key: "j", ctrl: false, shift: false, alt: false },
    };
    render();
    const habilitado = Array.from(container?.querySelectorAll("button") ?? []).find(
      (candidato) => candidato.textContent === "Restaurar todos os atalhos",
    ) as HTMLButtonElement;
    expect(habilitado.disabled).toBe(false);

    act(() => habilitado.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(hookMocks.resetAllShortcutBindings).toHaveBeenCalledTimes(1);
  });

  it("pesquisa tambem pelo acorde efetivo, nao pelo padrao", () => {
    hookMocks.overrides.current = {
      "canvas.tool-select": { key: "j", ctrl: false, shift: false, alt: false },
    };
    render();

    const busca = container?.querySelector<HTMLInputElement>('input[placeholder="Pesquisar atalhos"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(busca, "J");
      busca?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(container?.textContent).toContain("Selecionar");
    expect(container?.textContent).not.toContain("Retângulo");
  });

  it("mantem o padrao do catalogo quando nao ha override", () => {
    render();
    expect(resolveShortcutBindings({})["notebook.save"]).toEqual({
      key: "s", ctrl: true, shift: false, alt: false,
    });
    expect(teclasDe("Salvar agora")).toEqual(["Ctrl", "S"]);
  });
});
