import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import {
  clearWallpaperFile,
  DEFAULT_WALLPAPER_OPACITY,
  getWallpaperFile,
  getWallpaperOpacity,
  setWallpaperFile,
  setWallpaperOpacity,
} from "../lib/database";

// Estado do papel de parede para a tela de Ajustes.
//
// A divisao de responsabilidades e a mesma do resto do app: o Rust e dono do
// arquivo em disco (escolher, copiar, apagar, resolver caminho) e o TypeScript
// e dono das duas chaves em app_settings. Este hook so costura as duas metades
// na ORDEM que mantem disco e banco coerentes:
//
// - importar: copia primeiro, grava a chave depois. Se a gravacao falhar, o
//   arquivo novo fica orfao na pasta — e a proxima importacao o recolhe na
//   varredura. O inverso deixaria a chave apontando para um arquivo que nunca
//   existiu, e isso o app nao tem como consertar sozinho.
// - remover: apaga o arquivo primeiro, limpa a chave depois. Se a remocao
//   falhar, a interface continua mostrando o wallpaper que ainda esta no disco,
//   em vez de dizer "removido" com o arquivo ainda servido ao WebView.
type SelectedWallpaperImage = {
  file_name: string;
  file_path: string;
};

type ImportedWallpaper = {
  file_name: string;
  file_path: string;
  file_size: number;
};

export type WallpaperSettings = {
  fileName: string | null;
  previewUrl: string | null;
  opacity: number;
  isLoading: boolean;
  isImporting: boolean;
  error: string | null;
  chooseWallpaper: () => Promise<void>;
  removeWallpaper: () => Promise<void>;
  changeOpacity: (opacity: number) => void;
};

// O slider dispara um evento por pixel arrastado. O valor na tela acompanha o
// ponteiro na hora, mas a gravacao espera o arrasto assentar — sem isto, um
// arrasto de ponta a ponta viraria uma centena de escritas no SQLite.
const OPACITY_PERSIST_DELAY_MS = 250;

function describeError(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Nao foi possivel concluir a operacao.";
}

export function useWallpaperSettings(): WallpaperSettings {
  const [fileName, setFileName] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [opacity, setOpacity] = useState(DEFAULT_WALLPAPER_OPACITY);
  const [isLoading, setIsLoading] = useState(true);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingOpacityRef = useRef<number | null>(null);
  const opacityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [storedFileName, storedOpacity] = await Promise.all([
          getWallpaperFile(),
          getWallpaperOpacity(),
        ]);

        if (cancelled) {
          return;
        }

        setOpacity(storedOpacity);

        if (!storedFileName) {
          return;
        }

        // O arquivo pode ter sumido por fora do app (pasta apagada, perfil
        // trocado). Nesse caso a chave e limpa aqui mesmo, para a interface nao
        // ficar prometendo uma imagem que nao existe mais.
        const resolvedPath = await invoke<string | null>("resolve_wallpaper_path", {
          fileName: storedFileName,
        });

        if (cancelled) {
          return;
        }

        if (!resolvedPath) {
          await clearWallpaperFile();
          return;
        }

        setFileName(storedFileName);
        setPreviewUrl(convertFileSrc(resolvedPath));
      } catch (loadError: unknown) {
        if (!cancelled) {
          setError(describeError(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const persistOpacity = useCallback((value: number) => {
    void setWallpaperOpacity(value).catch((persistError: unknown) => {
      console.error("Nao foi possivel salvar a opacidade do papel de parede.", persistError);
    });
  }, []);

  // Uma gravacao pendente nao pode morrer com o painel: quem fecha Ajustes logo
  // depois de mexer no slider precisa reencontrar o valor que deixou.
  useEffect(() => {
    return () => {
      if (opacityTimerRef.current !== null) {
        clearTimeout(opacityTimerRef.current);
        opacityTimerRef.current = null;
      }

      if (pendingOpacityRef.current !== null) {
        persistOpacity(pendingOpacityRef.current);
        pendingOpacityRef.current = null;
      }
    };
  }, [persistOpacity]);

  const changeOpacity = useCallback(
    (nextOpacity: number) => {
      setOpacity(nextOpacity);
      pendingOpacityRef.current = nextOpacity;

      if (opacityTimerRef.current !== null) {
        clearTimeout(opacityTimerRef.current);
      }

      opacityTimerRef.current = setTimeout(() => {
        opacityTimerRef.current = null;
        const value = pendingOpacityRef.current;
        pendingOpacityRef.current = null;

        if (value !== null) {
          persistOpacity(value);
        }
      }, OPACITY_PERSIST_DELAY_MS);
    },
    [persistOpacity],
  );

  const chooseWallpaper = useCallback(async () => {
    setError(null);

    try {
      // Dialogo nativo primeiro, num comando separado da copia: enquanto ele
      // esta aberto o app nao esta importando nada, e o estado de carregamento
      // so faz sentido a partir daqui.
      const picked = await invoke<SelectedWallpaperImage | null>("select_wallpaper_image");

      if (!picked) {
        return;
      }

      setIsImporting(true);

      const imported = await invoke<ImportedWallpaper>("import_wallpaper", {
        sourcePath: picked.file_path,
      });

      await setWallpaperFile(imported.file_name);

      setFileName(imported.file_name);
      setPreviewUrl(convertFileSrc(imported.file_path));
    } catch (importError: unknown) {
      setError(describeError(importError));
    } finally {
      setIsImporting(false);
    }
  }, []);

  const removeWallpaper = useCallback(async () => {
    setError(null);

    try {
      await invoke("remove_wallpaper");
      await clearWallpaperFile();

      setFileName(null);
      setPreviewUrl(null);
    } catch (removeError: unknown) {
      setError(describeError(removeError));
    }
  }, []);

  return {
    fileName,
    previewUrl,
    opacity,
    isLoading,
    isImporting,
    error,
    chooseWallpaper,
    removeWallpaper,
    changeOpacity,
  };
}
