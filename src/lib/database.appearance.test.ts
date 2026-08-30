import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseMocks = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  get: vi.fn(),
  load: vi.fn(),
}));

const eventMocks = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { get: databaseMocks.get, load: databaseMocks.load },
}));

vi.mock("@tauri-apps/api/event", () => ({ emit: eventMocks.emit }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "main" }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import {
  APPEARANCE_PREFERENCES_CHANGED_EVENT,
  getAppearancePreferencesWithPresence,
  isAppearancePreferencesChangedPayload,
  setAppearanceAccent,
  setAppearanceGlassBlur,
  setAppearanceInterfaceContrast,
  setAppearanceTextContrast,
  setNightLightPreferences,
  setNightLightSettings,
  setNightLightStrength,
} from "./database";
import { DEFAULT_APPEARANCE_PREFERENCES } from "./appearancePreferences";

beforeEach(() => {
  databaseMocks.execute.mockReset().mockResolvedValue({ rowsAffected: 1 });
  databaseMocks.select.mockReset().mockResolvedValue([]);
  databaseMocks.get.mockReturnValue({
    execute: databaseMocks.execute,
    select: databaseMocks.select,
  });
  eventMocks.emit.mockReset().mockResolvedValue(undefined);
});

describe("preferencias globais de Aparencia em app_settings", () => {
  it("usa os defaults e informa a ausencia das chaves antigas de contraste", async () => {
    await expect(getAppearancePreferencesWithPresence("preloaded")).resolves.toEqual({
      preferences: DEFAULT_APPEARANCE_PREFERENCES,
      storedContrast: { interface: false, text: false },
    });
  });

  it("le e normaliza o snapshot persistido campo a campo", async () => {
    databaseMocks.select
      .mockResolvedValueOnce([{ value: "#339cff" }])
      .mockResolvedValueOnce([{ value: "#56a4ed" }])
      .mockResolvedValueOnce([{ value: "135" }])
      .mockResolvedValueOnce([{ value: "125" }])
      .mockResolvedValueOnce([{ value: "115" }])
      .mockResolvedValueOnce([{ value: "40" }])
      .mockResolvedValueOnce([{ value: JSON.stringify({
        version: 1,
        enabled: true,
        strength: 70,
        scheduleEnabled: true,
        startTime: "21:00",
        endTime: "06:00",
      }) }])
      .mockResolvedValueOnce([{ value: "75" }]);

    const result = await getAppearancePreferencesWithPresence("preloaded");
    expect(result.preferences).toEqual({
      accentLight: "#339CFF",
      accentDark: "#56A4ED",
      interfaceContrast: 135,
      textContrast: 125,
      titleContrast: 115,
      glassBlur: 40,
      nightLight: {
        version: 1,
        enabled: true,
        strength: 75,
        scheduleEnabled: true,
        startTime: "21:00",
        endTime: "06:00",
      },
    });
    expect(result.storedContrast).toEqual({ interface: true, text: true });
  });

  it("persiste antes de emitir mudancas discriminadas", async () => {
    await setAppearanceAccent("light", "#339cff", "preloaded");
    await setAppearanceInterfaceContrast(999, "preloaded");
    await setAppearanceTextContrast(89, "preloaded");
    await setAppearanceGlassBlur(42.6, "preloaded");

    expect(databaseMocks.execute.mock.calls.map((call) => call[1])).toEqual([
      ["appearance_accent_light", "#339CFF"],
      ["appearance_interface_contrast", "150"],
      ["appearance_text_contrast", "90"],
      ["appearance_glass_blur", "43"],
    ]);
    expect(eventMocks.emit.mock.calls).toEqual([
      [APPEARANCE_PREFERENCES_CHANGED_EVENT, { kind: "accent", theme: "light", value: "#339CFF", origin: "main" }],
      [APPEARANCE_PREFERENCES_CHANGED_EVENT, { kind: "interface-contrast", value: 150, origin: "main" }],
      [APPEARANCE_PREFERENCES_CHANGED_EVENT, { kind: "text-contrast", value: 90, origin: "main" }],
      [APPEARANCE_PREFERENCES_CHANGED_EVENT, { kind: "glass-blur", value: 43, origin: "main" }],
    ]);
    for (let index = 0; index < 4; index += 1) {
      expect(databaseMocks.execute.mock.invocationCallOrder[index]).toBeLessThan(
        eventMocks.emit.mock.invocationCallOrder[index] ?? Number.POSITIVE_INFINITY,
      );
    }
  });

  it("serializa a luz noturna versionada", async () => {
    await setNightLightPreferences({
      version: 1,
      enabled: true,
      strength: 65,
      scheduleEnabled: true,
      startTime: "20:00",
      endTime: "07:00",
    }, "preloaded");

    const value = databaseMocks.execute.mock.calls[0]?.[1]?.[1];
    expect(JSON.parse(value)).toEqual({
      version: 1,
      enabled: true,
      strength: 65,
      scheduleEnabled: true,
      startTime: "20:00",
      endTime: "07:00",
    });
    expect(databaseMocks.execute.mock.calls[0]?.[1]?.slice(2)).toEqual([
      "appearance_night_light_strength",
      "65",
    ]);
  });

  it("persiste forca e estrutura da luz noturna sem sobrescrever o outro eixo", async () => {
    await setNightLightStrength(78, "preloaded");
    await setNightLightSettings({
      version: 1,
      enabled: true,
      strength: 12,
      scheduleEnabled: true,
      startTime: "21:00",
      endTime: "06:30",
    }, "preloaded");

    expect(databaseMocks.execute.mock.calls.map((call) => call[1])).toEqual([
      ["appearance_night_light_strength", "78"],
      [
        "appearance_night_light",
        expect.stringContaining('"scheduleEnabled":true'),
      ],
    ]);
    expect(eventMocks.emit.mock.calls).toEqual([
      [APPEARANCE_PREFERENCES_CHANGED_EVENT, {
        kind: "night-light-strength",
        value: 78,
        origin: "main",
      }],
      [APPEARANCE_PREFERENCES_CHANGED_EVENT, {
        kind: "night-light-settings",
        value: {
          enabled: true,
          scheduleEnabled: true,
          startTime: "21:00",
          endTime: "06:30",
        },
        origin: "main",
      }],
    ]);
  });

  it("nao emite se o SQLite falha e nao desfaz sucesso por falha do evento", async () => {
    databaseMocks.execute.mockRejectedValueOnce(new Error("falha no SQLite"));
    await expect(setAppearanceGlassBlur(50, "preloaded")).rejects.toThrow("falha no SQLite");
    expect(eventMocks.emit).not.toHaveBeenCalled();

    databaseMocks.execute.mockResolvedValueOnce({ rowsAffected: 1 });
    eventMocks.emit.mockRejectedValueOnce(new Error("evento indisponivel"));
    await expect(setAppearanceGlassBlur(50, "preloaded")).resolves.toBeUndefined();
  });

  it("rejeita payloads incompletos, fora da faixa ou sem versao", () => {
    expect(isAppearancePreferencesChangedPayload({
      kind: "accent", theme: "dark", value: "#56A4ED", origin: "reader-window",
    })).toBe(true);
    expect(isAppearancePreferencesChangedPayload({
      kind: "glass-blur", value: 101, origin: "main",
    })).toBe(false);
    expect(isAppearancePreferencesChangedPayload({
      kind: "night-light",
      value: { enabled: true, strength: 50, scheduleEnabled: false, startTime: "20:00", endTime: "07:00" },
      origin: "main",
    })).toBe(false);
    expect(isAppearancePreferencesChangedPayload({
      kind: "night-light-strength", value: 72, origin: "main",
    })).toBe(true);
    expect(isAppearancePreferencesChangedPayload({
      kind: "night-light-settings",
      value: { enabled: true, scheduleEnabled: true, startTime: "20:00", endTime: "07:00" },
      origin: "main",
    })).toBe(true);
    expect(isAppearancePreferencesChangedPayload({
      kind: "night-light-settings",
      value: { enabled: true, scheduleEnabled: true, startTime: "25:00", endTime: "07:00" },
      origin: "main",
    })).toBe(false);
    expect(isAppearancePreferencesChangedPayload({ kind: "text-contrast", value: 120 })).toBe(false);
  });
});
