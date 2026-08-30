import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  get: vi.fn(),
  load: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    get: databaseMocks.get,
    load: databaseMocks.load,
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: eventMocks.emit,
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (path: string) => `asset://localhost/${path}`,
}));

import {
  clearWallpaperFile,
  DEFAULT_WALLPAPER_BRIGHTNESS,
  DEFAULT_WALLPAPER_OPACITY,
  getWallpaperBrightness,
  getWallpaperFile,
  getWallpaperOpacity,
  normalizeWallpaperBrightness,
  normalizeWallpaperOpacity,
  setWallpaperBrightness,
  setWallpaperFile,
  setWallpaperOpacity,
  WALLPAPER_SETTINGS_CHANGED_EVENT,
} from "./database";

beforeEach(() => {
  databaseMocks.execute.mockReset();
  databaseMocks.execute.mockResolvedValue({ rowsAffected: 1 });
  databaseMocks.select.mockReset();
  databaseMocks.select.mockResolvedValue([]);
  databaseMocks.get.mockReturnValue({
    execute: databaseMocks.execute,
    select: databaseMocks.select,
  });
  eventMocks.emit.mockReset().mockResolvedValue(undefined);
});

describe("papel de parede em app_settings", () => {
  it("le o nome do arquivo persistido", async () => {
    databaseMocks.select.mockResolvedValueOnce([{ value: "wallpaper-1755648000.png" }]);

    await expect(getWallpaperFile("preloaded")).resolves.toBe("wallpaper-1755648000.png");
    expect(databaseMocks.select).toHaveBeenCalledWith(
      "SELECT value FROM app_settings WHERE key = $1",
      ["wallpaper_file"],
    );
  });

  it("trata ausencia e string vazia como o mesmo estado: sem wallpaper", async () => {
    await expect(getWallpaperFile("preloaded")).resolves.toBeNull();

    databaseMocks.select.mockResolvedValueOnce([{ value: "   " }]);
    await expect(getWallpaperFile("preloaded")).resolves.toBeNull();
  });

  it("grava o NOME do arquivo, nunca um caminho absoluto", async () => {
    await setWallpaperFile("wallpaper-1755648000.webp", "preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith(
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["wallpaper_file", "wallpaper-1755648000.webp"],
    );
    expect(eventMocks.emit).toHaveBeenCalledWith(WALLPAPER_SETTINGS_CHANGED_EVENT, {
      origin: "main",
    });
  });

  it("remove a chave em vez de gravar vazio ao limpar o wallpaper", async () => {
    await clearWallpaperFile("preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith("DELETE FROM app_settings WHERE key = $1", [
      "wallpaper_file",
    ]);
    expect(eventMocks.emit).toHaveBeenCalledWith(WALLPAPER_SETTINGS_CHANGED_EVENT, {
      origin: "main",
    });
  });

  it("persiste a opacidade como inteiro", async () => {
    await setWallpaperOpacity(35, "preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith(
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["wallpaper_opacity", "35"],
    );
    expect(eventMocks.emit).toHaveBeenCalledWith(WALLPAPER_SETTINGS_CHANGED_EVENT, {
      origin: "main",
    });
  });

  it("le a opacidade persistida", async () => {
    databaseMocks.select.mockResolvedValueOnce([{ value: "12" }]);

    await expect(getWallpaperOpacity("preloaded")).resolves.toBe(12);
  });

  it("cai no padrao quando o valor persistido nao e um inteiro utilizavel", async () => {
    for (const stored of ["", "  ", "opaco", "NaN"]) {
      databaseMocks.select.mockResolvedValueOnce([{ value: stored }]);
      await expect(getWallpaperOpacity("preloaded")).resolves.toBe(DEFAULT_WALLPAPER_OPACITY);
    }

    // Sem linha nenhuma tambem.
    await expect(getWallpaperOpacity("preloaded")).resolves.toBe(DEFAULT_WALLPAPER_OPACITY);
  });

  it("prende a opacidade na faixa do slider", () => {
    expect(normalizeWallpaperOpacity(-40)).toBe(0);
    expect(normalizeWallpaperOpacity(0)).toBe(0);
    expect(normalizeWallpaperOpacity(100)).toBe(100);
    expect(normalizeWallpaperOpacity(140)).toBe(100);
    expect(normalizeWallpaperOpacity("62")).toBe(62);
    expect(normalizeWallpaperOpacity(62.6)).toBe(63);
    expect(normalizeWallpaperOpacity(null)).toBe(DEFAULT_WALLPAPER_OPACITY);
  });

  it("grava a opacidade ja normalizada, sem deixar valor fora da faixa no banco", async () => {
    await setWallpaperOpacity(999, "preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith(
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["wallpaper_opacity", "100"],
    );
  });

  it("nao transforma falha de sincronizacao em falha da escrita confirmada", async () => {
    eventMocks.emit.mockRejectedValue(new Error("evento indisponivel"));

    await expect(setWallpaperOpacity(70, "preloaded")).resolves.toBeUndefined();
    expect(databaseMocks.execute).toHaveBeenCalledTimes(1);
  });

  it("persiste e le o brilho como percentual inteiro", async () => {
    await setWallpaperBrightness(125, "preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith(
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["wallpaper_brightness", "125"],
    );
    expect(eventMocks.emit).toHaveBeenCalledWith(WALLPAPER_SETTINGS_CHANGED_EVENT, {
      origin: "main",
    });

    databaseMocks.select.mockResolvedValueOnce([{ value: "75" }]);
    await expect(getWallpaperBrightness("preloaded")).resolves.toBe(75);
  });

  it("normaliza o brilho para 50-150 e usa 100 quando o valor e invalido", async () => {
    expect(normalizeWallpaperBrightness(10)).toBe(50);
    expect(normalizeWallpaperBrightness(50)).toBe(50);
    expect(normalizeWallpaperBrightness(100)).toBe(100);
    expect(normalizeWallpaperBrightness(150)).toBe(150);
    expect(normalizeWallpaperBrightness(190)).toBe(150);
    expect(normalizeWallpaperBrightness(112.6)).toBe(113);
    expect(normalizeWallpaperBrightness("opaco")).toBe(DEFAULT_WALLPAPER_BRIGHTNESS);
    expect(normalizeWallpaperBrightness(null)).toBe(DEFAULT_WALLPAPER_BRIGHTNESS);

    await expect(getWallpaperBrightness("preloaded")).resolves.toBe(DEFAULT_WALLPAPER_BRIGHTNESS);
  });
});
