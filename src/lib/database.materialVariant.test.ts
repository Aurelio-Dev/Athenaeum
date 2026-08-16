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
}));

import {
  getMaterialVariant,
  isMaterialVariantChangedPayload,
  MATERIAL_VARIANT_CHANGED_EVENT,
  setMaterialVariant,
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
  eventMocks.emit.mockReset();
  eventMocks.emit.mockResolvedValue(undefined);
});

describe("preferencia de material", () => {
  it("cai em flat sem valor persistido", async () => {
    await expect(getMaterialVariant("preloaded")).resolves.toBe("flat");
    expect(databaseMocks.select).toHaveBeenCalledWith(
      "SELECT value FROM app_settings WHERE key = $1",
      ["material_variant"],
    );
  });

  it("le o valor persistido", async () => {
    databaseMocks.select.mockResolvedValueOnce([{ value: "glass" }]);

    await expect(getMaterialVariant("preloaded")).resolves.toBe("glass");
  });

  it("cai em flat quando o valor persistido nao pertence ao eixo", async () => {
    databaseMocks.select.mockResolvedValueOnce([{ value: "frosted" }]);

    await expect(getMaterialVariant("preloaded")).resolves.toBe("flat");
  });

  it("emite o novo material depois de persistir a preferencia", async () => {
    await setMaterialVariant("glass", "preloaded");

    expect(databaseMocks.execute).toHaveBeenCalledWith(
      "INSERT INTO app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      ["material_variant", "glass"],
    );
    expect(eventMocks.emit).toHaveBeenCalledTimes(1);
    expect(eventMocks.emit).toHaveBeenCalledWith(MATERIAL_VARIANT_CHANGED_EVENT, {
      material: "glass",
      origin: "main",
    });
    expect(databaseMocks.execute.mock.invocationCallOrder[0]).toBeLessThan(
      eventMocks.emit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("nao emite quando a escrita falha", async () => {
    databaseMocks.execute.mockRejectedValueOnce(new Error("falha no SQLite"));

    await expect(setMaterialVariant("glass", "preloaded")).rejects.toThrow("falha no SQLite");

    expect(eventMocks.emit).not.toHaveBeenCalled();
  });

  it("rejeita payloads fora do eixo material", () => {
    expect(isMaterialVariantChangedPayload({ material: "glass", origin: "main" })).toBe(true);
    expect(isMaterialVariantChangedPayload({ material: "flat", origin: "reader-window" })).toBe(true);
    expect(isMaterialVariantChangedPayload({ material: "frosted", origin: "main" })).toBe(false);
    expect(isMaterialVariantChangedPayload({ material: "glass" })).toBe(false);
    expect(isMaterialVariantChangedPayload(null)).toBe(false);
  });
});
