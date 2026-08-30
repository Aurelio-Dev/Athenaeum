// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  KEYBOARD_SHORTCUTS_CACHE_STORAGE_KEY,
  KeyboardShortcutsProvider,
  useKeyboardShortcuts,
  type KeyboardShortcutsContextValue,
} from "./useKeyboardShortcuts";

const eventMocks = vi.hoisted(() => {
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  return {
    handlers,
    listen: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(eventName, handler);
      return () => handlers.delete(eventName);
    }),
  };
});

const databaseMocks = vi.hoisted(() => ({
  getOverrides: vi.fn(),
  setOverrides: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: eventMocks.listen }));

vi.mock("../lib/database", () => ({
  KEYBOARD_SHORTCUTS_CHANGED_EVENT: "app:keyboard-shortcuts-changed",
  getShortcutOverrides: databaseMocks.getOverrides,
  setShortcutOverrides: databaseMocks.setOverrides,
  isKeyboardShortcutsChangedPayload: (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) return false;
    const candidate = payload as Record<string, unknown>;
    return (
      typeof candidate.origin === "string"
      && typeof candidate.overrides === "object"
      && candidate.overrides !== null
    );
  },
}));

// jsdom nao traz localStorage util em todos os providers do projeto; o stub
// local mantem o teste independente do ambiente.
const memoryStorage = new Map<string, string>();

let container: HTMLDivElement;
let root: Root;
let latestContext: KeyboardShortcutsContextValue | null = null;

function Probe() {
  const context = useKeyboardShortcuts();
  latestContext = context;
  const select = context.bindings["canvas.tool-select"];
  return (
    <output
      data-testid="select"
      data-key={select.key}
      data-ctrl={String(select.ctrl)}
      data-overrides={String(Object.keys(context.overrides).length)}
    />
  );
}

async function renderProvider(source: "loaded" | "preloaded" = "loaded") {
  await act(async () => {
    root.render(
      <KeyboardShortcutsProvider databaseSource={source}>
        <Probe />
      </KeyboardShortcutsProvider>,
    );
  });
}

function lido(atributo: string): string | null {
  return container.querySelector('[data-testid="select"]')?.getAttribute(atributo) ?? null;
}

beforeEach(() => {
  memoryStorage.clear();
  eventMocks.handlers.clear();
  eventMocks.listen.mockClear();
  databaseMocks.getOverrides.mockReset().mockResolvedValue({});
  databaseMocks.setOverrides.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => memoryStorage.get(key) ?? null,
    setItem: (key: string, value: string) => void memoryStorage.set(key, value),
    removeItem: (key: string) => void memoryStorage.delete(key),
    clear: () => memoryStorage.clear(),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  latestContext = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("KeyboardShortcutsProvider", () => {
  it("parte do padrao e reconcilia com o SQLite", async () => {
    databaseMocks.getOverrides.mockResolvedValue({
      "canvas.tool-select": { key: "j", ctrl: true, shift: false, alt: false },
    });
    await renderProvider();

    expect(lido("data-key")).toBe("j");
    expect(lido("data-ctrl")).toBe("true");
  });

  it("usa o cache local no primeiro commit, antes do SQLite responder", async () => {
    memoryStorage.set(KEYBOARD_SHORTCUTS_CACHE_STORAGE_KEY, JSON.stringify({
      version: 1,
      bindings: { "canvas.tool-select": { key: "m", ctrl: false, shift: false, alt: false } },
    }));
    let resolver: (value: unknown) => void = () => {};
    databaseMocks.getOverrides.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));

    await renderProvider();
    expect(lido("data-key")).toBe("m");

    await act(async () => {
      resolver({});
      await Promise.resolve();
    });
    expect(lido("data-key")).toBe("v");
  });

  it("nao deixa a leitura inicial atrasada desfazer uma alteracao local", async () => {
    let resolver: (value: unknown) => void = () => {};
    databaseMocks.getOverrides.mockReturnValue(new Promise((resolve) => { resolver = resolve; }));
    await renderProvider();

    act(() => {
      latestContext?.setShortcutBinding("canvas.tool-select", {
        key: "j", ctrl: false, shift: false, alt: false,
      });
    });
    expect(lido("data-key")).toBe("j");

    await act(async () => {
      resolver({ "canvas.tool-select": { key: "z", ctrl: true, shift: false, alt: false } });
      await Promise.resolve();
    });
    expect(lido("data-key")).toBe("j");
  });

  it("persiste a alteracao e recusa binding invalido sem gravar", async () => {
    await renderProvider("preloaded");

    let recusa = null;
    act(() => {
      recusa = latestContext?.setShortcutBinding("canvas.tool-select", {
        key: "r", ctrl: false, shift: false, alt: false,
      }) ?? null;
    });
    expect(recusa).toEqual({ reason: "conflict", conflictId: "canvas.tool-rectangle" });
    expect(databaseMocks.setOverrides).not.toHaveBeenCalled();

    act(() => {
      latestContext?.setShortcutBinding("canvas.tool-select", {
        key: "j", ctrl: false, shift: false, alt: false,
      });
    });
    expect(databaseMocks.setOverrides).toHaveBeenCalledWith(
      { "canvas.tool-select": { key: "j", ctrl: false, shift: false, alt: false } },
      "preloaded",
    );
  });

  it("sincroniza o mapa vindo de outra janela e ignora payload invalido", async () => {
    await renderProvider("preloaded");

    act(() => eventMocks.handlers.get("app:keyboard-shortcuts-changed")?.({
      payload: {
        origin: "reader-window",
        overrides: { "canvas.tool-select": { key: "n", ctrl: false, shift: false, alt: false } },
      },
    }));
    expect(lido("data-key")).toBe("n");

    act(() => eventMocks.handlers.get("app:keyboard-shortcuts-changed")?.({
      payload: { overrides: null },
    }));
    expect(lido("data-key")).toBe("n");
    expect(databaseMocks.setOverrides).not.toHaveBeenCalled();
  });

  it("restaura uma linha e todas, voltando ao padrao do catalogo", async () => {
    databaseMocks.getOverrides.mockResolvedValue({
      "canvas.tool-select": { key: "j", ctrl: false, shift: false, alt: false },
      "notebook.save": { key: "k", ctrl: true, shift: false, alt: false },
    });
    await renderProvider();
    expect(lido("data-overrides")).toBe("2");

    act(() => latestContext?.resetShortcutBinding("canvas.tool-select"));
    expect(lido("data-key")).toBe("v");
    expect(lido("data-overrides")).toBe("1");

    act(() => latestContext?.resetAllShortcutBindings());
    expect(lido("data-overrides")).toBe("0");
    expect(databaseMocks.setOverrides).toHaveBeenLastCalledWith({}, "loaded");
  });

  it("expoe matchesShortcut ja com o acorde personalizado", async () => {
    databaseMocks.getOverrides.mockResolvedValue({
      "canvas.tool-select": { key: "j", ctrl: true, shift: false, alt: false },
    });
    await renderProvider();

    const evento = (key: string, ctrl: boolean) => ({
      key, ctrlKey: ctrl, metaKey: false, shiftKey: false, altKey: false,
    });
    expect(latestContext?.matchesShortcut("canvas.tool-select", evento("j", true))).toBe(true);
    expect(latestContext?.matchesShortcut("canvas.tool-select", evento("v", false))).toBe(false);
    expect(latestContext?.matchesShortcut("canvas.tool-rectangle", evento("r", false))).toBe(true);
  });
});
