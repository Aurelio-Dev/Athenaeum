import { useCallback, useEffect, useRef } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  clearWallpaperFile,
  DEFAULT_WALLPAPER_BRIGHTNESS,
  getWallpaperBrightness,
  getWallpaperFile,
  getWallpaperOpacity,
  normalizeWallpaperBrightness,
  normalizeWallpaperOpacity,
  WALLPAPER_SETTINGS_CHANGED_EVENT,
  type DatabaseHandleSource,
} from "../lib/database";

// O slider descreve VISIBILIDADE da imagem, mas quem varia e o scrim que
// protege o texto. A curva linear reserva no minimo 60% de tinta da superficie:
// slider 0 -> alpha 1; 50 -> 0.8; 100 -> 0.6. A imagem permanece em alpha 1.
export const MIN_WALLPAPER_SCRIM_ALPHA = 0.6;

export function wallpaperScrimAlpha(opacity: number): number {
  const normalized = normalizeWallpaperOpacity(opacity);
  return 1 - (normalized / 100) * (1 - MIN_WALLPAPER_SCRIM_ALPHA);
}

function cssUrl(url: string): string {
  // convertFileSrc devolve uma URL percent-encoded, mas o diretorio pai pode
  // conter aspas ou barras no Windows. Escapar a string mantem o valor dentro
  // de url("...") sem transformar parte do caminho em CSS.
  const escaped = url
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\a ")
    .replace(/\r/g, "\\d ")
    .replace(/\f/g, "\\c ");
  return `url("${escaped}")`;
}

export function applyWallpaperPresentation(
  assetUrl: string | null,
  opacity: number,
  brightness: number,
): void {
  const root = window.document.documentElement;

  if (!assetUrl) {
    delete root.dataset.wallpaper;
    delete root.dataset.wallpaperTranslucent;
    delete root.dataset.wallpaperBrightnessAdjusted;
    root.style.removeProperty("--glass-wallpaper-image");
    root.style.removeProperty("--glass-wallpaper-scrim-alpha");
    root.style.removeProperty("--glass-wallpaper-brightness");
    return;
  }

  root.dataset.wallpaper = "active";
  if (normalizeWallpaperOpacity(opacity) > 0) {
    root.dataset.wallpaperTranslucent = "true";
  } else {
    delete root.dataset.wallpaperTranslucent;
  }
  root.style.setProperty("--glass-wallpaper-image", cssUrl(assetUrl));
  root.style.setProperty(
    "--glass-wallpaper-scrim-alpha",
    wallpaperScrimAlpha(opacity).toFixed(3),
  );

  const normalizedBrightness = normalizeWallpaperBrightness(brightness);
  if (normalizedBrightness === DEFAULT_WALLPAPER_BRIGHTNESS) {
    delete root.dataset.wallpaperBrightnessAdjusted;
    root.style.removeProperty("--glass-wallpaper-brightness");
  } else {
    root.dataset.wallpaperBrightnessAdjusted = "true";
    root.style.setProperty(
      "--glass-wallpaper-brightness",
      (normalizedBrightness / 100).toFixed(3),
    );
  }
}

async function readWallpaperPresentation(source: DatabaseHandleSource) {
  const [fileName, opacity, brightness] = await Promise.all([
    getWallpaperFile(source),
    getWallpaperOpacity(source),
    getWallpaperBrightness(source),
  ]);

  if (!fileName) {
    return { assetUrl: null, opacity, brightness };
  }

  const resolvedPath = await invoke<string | null>("resolve_wallpaper_path", { fileName });
  if (!resolvedPath) {
    // Autocura do mesmo estado tratado pela tela de Ajustes: um nome sem
    // arquivo fisico nao deve manter uma camada quebrada nem uma chave zumbi.
    await clearWallpaperFile(source);
    return { assetUrl: null, opacity, brightness };
  }

  return { assetUrl: convertFileSrc(resolvedPath), opacity, brightness };
}

// Reconciliacao global: roda em toda janela coberta por ThemeProvider. Assim o
// wallpaper aparece sem depender de abrir Ajustes, e uma janela nativa aberta
// recebe trocas feitas na principal sem trafegar caminho absoluto no evento.
export function useWallpaperBackdrop(databaseSource: DatabaseHandleSource): void {
  const refreshIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const refreshId = ++refreshIdRef.current;

    try {
      const presentation = await readWallpaperPresentation(databaseSource);
      if (refreshId !== refreshIdRef.current) {
        return;
      }
      applyWallpaperPresentation(
        presentation.assetUrl,
        presentation.opacity,
        presentation.brightness,
      );
    } catch (error) {
      if (refreshId === refreshIdRef.current) {
        applyWallpaperPresentation(null, 0, DEFAULT_WALLPAPER_BRIGHTNESS);
      }
      console.warn("Nao foi possivel carregar o papel de parede.", error);
    }
  }, [databaseSource]);

  useEffect(() => {
    void refresh();

    return () => {
      refreshIdRef.current += 1;
      applyWallpaperPresentation(null, 0, DEFAULT_WALLPAPER_BRIGHTNESS);
    };
  }, [refresh]);

  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen(WALLPAPER_SETTINGS_CHANGED_EVENT, () => {
      void refresh();
    })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel observar mudancas do papel de parede.", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [refresh]);
}
