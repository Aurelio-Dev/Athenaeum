// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWallpaperBackdrop } from "./useWallpaperBackdrop";

const tauriMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => `asset://localhost/${encodeURIComponent(path)}`),
}));

const eventMocks = vi.hoisted(() => {
  let handler: (() => void) | null = null;
  return {
    get handler() {
      return handler;
    },
    listen: vi.fn(async (_event: string, nextHandler: () => void) => {
      handler = nextHandler;
      return () => {
        handler = null;
      };
    }),
  };
});

const databaseMocks = vi.hoisted(() => ({
  getWallpaperFile: vi.fn(),
  getWallpaperOpacity: vi.fn(),
  clearWallpaperFile: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriMocks.invoke,
  convertFileSrc: tauriMocks.convertFileSrc,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: eventMocks.listen,
}));

vi.mock("../lib/database", () => ({
  WALLPAPER_SETTINGS_CHANGED_EVENT: "app:wallpaper-settings-changed",
  getWallpaperFile: databaseMocks.getWallpaperFile,
  getWallpaperOpacity: databaseMocks.getWallpaperOpacity,
  clearWallpaperFile: databaseMocks.clearWallpaperFile,
  normalizeWallpaperOpacity: (value: number) => Math.min(100, Math.max(0, Math.round(value))),
}));

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function BackdropConsumer() {
  useWallpaperBackdrop("preloaded");
  return null;
}

async function render() {
  await act(async () => {
    root?.render(<BackdropConsumer />);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function dispatchWallpaperEvent() {
  await act(async () => {
    eventMocks.handler?.();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  tauriMocks.invoke.mockReset();
  tauriMocks.convertFileSrc.mockClear();
  eventMocks.listen.mockClear();
  databaseMocks.getWallpaperFile.mockReset().mockResolvedValue(null);
  databaseMocks.getWallpaperOpacity.mockReset().mockResolvedValue(50);
  databaseMocks.clearWallpaperFile.mockReset().mockResolvedValue(undefined);

  delete document.documentElement.dataset.wallpaper;
  document.documentElement.style.removeProperty("--glass-wallpaper-image");
  document.documentElement.style.removeProperty("--glass-wallpaper-scrim-alpha");

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

describe("wallpaper global da janela", () => {
  it("sem nome persistido nao resolve caminho nem ativa a camada", async () => {
    await render();

    expect(tauriMocks.invoke).not.toHaveBeenCalled();
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
  });

  it("resolve o nome no Rust e serve a URL convertida pelo protocolo asset", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    tauriMocks.invoke.mockResolvedValue("C:\\dados\\wallpaper\\wallpaper-1.png");

    await render();

    expect(tauriMocks.invoke).toHaveBeenCalledWith("resolve_wallpaper_path", {
      fileName: "wallpaper-1.png",
    });
    expect(tauriMocks.convertFileSrc).toHaveBeenCalledWith(
      "C:\\dados\\wallpaper\\wallpaper-1.png",
    );
    expect(document.documentElement.dataset.wallpaper).toBe("active");
    expect(
      document.documentElement.style.getPropertyValue("--glass-wallpaper-image"),
    ).toContain("asset://localhost/");
    expect(
      document.documentElement.style.getPropertyValue("--glass-wallpaper-scrim-alpha"),
    ).toBe("0.800");
  });

  it("relê a fonte de verdade quando outra janela muda a opacidade", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    tauriMocks.invoke.mockResolvedValue("C:\\dados\\wallpaper\\wallpaper-1.png");
    await render();

    databaseMocks.getWallpaperOpacity.mockResolvedValue(100);
    await dispatchWallpaperEvent();

    expect(databaseMocks.getWallpaperFile).toHaveBeenCalledTimes(2);
    expect(
      document.documentElement.style.getPropertyValue("--glass-wallpaper-scrim-alpha"),
    ).toBe("0.600");
  });

  it("limpa a chave zumbi quando o arquivo persistido sumiu", async () => {
    databaseMocks.getWallpaperFile.mockResolvedValue("wallpaper-1.png");
    tauriMocks.invoke.mockResolvedValue(null);

    await render();

    expect(databaseMocks.clearWallpaperFile).toHaveBeenCalledWith("preloaded");
    expect(document.documentElement.dataset.wallpaper).toBeUndefined();
  });
});
