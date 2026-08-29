import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseState = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  execute: vi.fn(),
  select: vi.fn(),
  get: vi.fn(),
  load: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    get: databaseState.get,
    load: databaseState.load,
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(),
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import {
  clearChromeVariant,
  deleteSetting,
  getChromeVariant,
  getGlassNoticeSeen,
  getSetting,
  resolveChromeVariant,
  setChromeVariant,
  setGlassNoticeSeen,
  setSetting,
  type ChromeVariant,
  type MaterialVariant,
} from "./database";

beforeEach(() => {
  databaseState.settings.clear();
  databaseState.execute.mockReset();
  databaseState.select.mockReset();
  databaseState.get.mockReturnValue({
    execute: databaseState.execute,
    select: databaseState.select,
  });

  databaseState.execute.mockImplementation(async (sql: string, values: unknown[] = []) => {
    const key = typeof values[0] === "string" ? values[0] : "";

    if (sql.startsWith("INSERT INTO app_settings")) {
      const value = typeof values[1] === "string" ? values[1] : "";
      databaseState.settings.set(key, value);
      return { rowsAffected: 1 };
    }

    if (sql === "DELETE FROM app_settings WHERE key = $1") {
      return { rowsAffected: databaseState.settings.delete(key) ? 1 : 0 };
    }

    throw new Error(`SQL inesperado no teste: ${sql}`);
  });

  databaseState.select.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql !== "SELECT value FROM app_settings WHERE key = $1") {
      throw new Error(`SQL inesperado no teste: ${sql}`);
    }

    const key = typeof values[0] === "string" ? values[0] : "";
    const value = databaseState.settings.get(key);
    return value === undefined ? [] : [{ value }];
  });
});

describe("helpers genericos de app_settings", () => {
  it("deleteSetting remove a chave e a leitura seguinte retorna null", async () => {
    await setSetting("teste", "valor", "preloaded");

    await deleteSetting("teste", "preloaded");

    await expect(getSetting("teste", "preloaded")).resolves.toBeNull();
  });

  it("deleteSetting e idempotente quando a chave nao existe", async () => {
    await expect(deleteSetting("ausente", "preloaded")).resolves.toBeUndefined();
    expect(databaseState.execute).toHaveBeenCalledWith(
      "DELETE FROM app_settings WHERE key = $1",
      ["ausente"],
    );
  });
});

describe("preferencia de chrome em app_settings", () => {
  it("preserva apenas docked e floating; ausencia, vazio e valor invalido viram null", async () => {
    const cases: ReadonlyArray<{ stored: string | null; expected: ChromeVariant | null }> = [
      { stored: null, expected: null },
      { stored: "docked", expected: "docked" },
      { stored: "floating", expected: "floating" },
      { stored: "islands", expected: null },
      { stored: "", expected: null },
    ];

    for (const { stored, expected } of cases) {
      databaseState.settings.clear();
      if (stored !== null) {
        databaseState.settings.set("chrome_variant", stored);
      }

      await expect(getChromeVariant("preloaded")).resolves.toBe(expected);
    }
  });

  it("setChromeVariant faz upsert sem duplicar a chave", async () => {
    await setChromeVariant("docked", "preloaded");
    await setChromeVariant("floating", "preloaded");

    expect(databaseState.settings.size).toBe(1);
    expect(databaseState.settings.get("chrome_variant")).toBe("floating");
    expect(databaseState.execute).toHaveBeenNthCalledWith(
      2,
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["chrome_variant", "floating"],
    );
  });

  it("clearChromeVariant remove a chave em vez de gravar string vazia", async () => {
    databaseState.settings.set("chrome_variant", "docked");
    databaseState.execute.mockClear();

    await clearChromeVariant("preloaded");

    expect(databaseState.settings.has("chrome_variant")).toBe(false);
    expect(databaseState.execute).toHaveBeenCalledOnce();
    expect(databaseState.execute).toHaveBeenCalledWith(
      "DELETE FROM app_settings WHERE key = $1",
      ["chrome_variant"],
    );
  });
});

describe("aviso de material Vidro em app_settings", () => {
  it("ausencia e valor invalido significam que o aviso ainda nao foi visto", async () => {
    await expect(getGlassNoticeSeen("preloaded")).resolves.toBe(false);

    databaseState.settings.set("glass_notice_seen", "true");
    await expect(getGlassNoticeSeen("preloaded")).resolves.toBe(true);

    databaseState.settings.set("glass_notice_seen", "sim");
    await expect(getGlassNoticeSeen("preloaded")).resolves.toBe(false);
  });

  it('setGlassNoticeSeen grava o booleano como a string "true"', async () => {
    await setGlassNoticeSeen("preloaded");

    expect(databaseState.settings.get("glass_notice_seen")).toBe("true");
  });
});

describe("resolveChromeVariant", () => {
  it("resolve as seis combinacoes de preferencia e material", () => {
    const cases: ReadonlyArray<{
      stored: ChromeVariant | null;
      material: MaterialVariant;
      expected: ChromeVariant;
    }> = [
      { stored: null, material: "flat", expected: "docked" },
      { stored: "docked", material: "flat", expected: "docked" },
      { stored: "floating", material: "flat", expected: "docked" },
      { stored: null, material: "glass", expected: "floating" },
      { stored: "docked", material: "glass", expected: "docked" },
      { stored: "floating", material: "glass", expected: "floating" },
    ];

    for (const { stored, material, expected } of cases) {
      expect(resolveChromeVariant(stored, material)).toBe(expected);
    }
  });
});
