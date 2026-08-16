import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getMaterialVariant,
  isMaterialVariantChangedPayload,
  MATERIAL_VARIANT_CHANGED_EVENT,
  setMaterialVariant,
  type DatabaseHandleSource,
  type MaterialVariant,
} from "../lib/database";

// Fonte UNICA da aparencia global do app: o MODO (claro/escuro) e o MATERIAL
// (chapado/vidro). Vive num contexto para que o botao de contraste do rodape da
// sidebar e o controle "Tema" do SettingsPanel compartilhem o MESMO estado —
// dois useState independentes desincronizariam (um trocaria o tema sem o outro
// perceber).
//
// Os dois eixos sao ortogonais e persistem em lugares diferentes de proposito:
//
// - MODO em localStorage (nao em app_settings/SQLite): a leitura sincrona antes
//   do primeiro paint evita o flash de tema errado na abertura, que uma leitura
//   assincrona via IPC do banco traria.
// - MATERIAL em app_settings (chave material_variant), como show_divider_lines e
//   icon_variant. Ele nao cabe no localStorage: e uma preferencia unica que
//   precisa chegar as janelas nativas separadas (Reader, Anotacoes, Caderno)
//   pelo evento MATERIAL_VARIANT_CHANGED_EVENT, e cada janela tem seu proprio
//   localStorage.
export type Theme = "light" | "dark";

const themeStorageKey = "athenaeum-theme";

function readStoredTheme(): Theme {
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  material: MaterialVariant;
  setMaterial: (material: MaterialVariant) => void;
};

type ThemeProviderProps = {
  children: ReactNode;
  // Janelas nativas (Reader, Anotacoes, Caderno) leem pelo handle "preloaded":
  // elas nao podem chamar Database.load, que recriaria o pool por baixo das
  // outras janelas. A janela principal fica no default "loaded".
  databaseSource?: DatabaseHandleSource;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children, databaseSource = "loaded" }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [material, setMaterialState] = useState<MaterialVariant>("flat");
  // Um valor vindo do evento (ou do proprio setMaterial local) e mais recente
  // que a leitura de montagem em voo. Sem esta marca, uma troca feita em outra
  // janela durante o bootstrap seria sobrescrita pelo valor antigo do SQLite.
  const hasFresherMaterialRef = useRef(false);

  // Aplica a classe .dark no <html> (que liga as variaveis CSS do tema escuro,
  // ver styles/index.css) e persiste a escolha. Roda no mount para restaurar a
  // preferencia salva e a cada troca.
  useEffect(() => {
    window.document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  // Eixo ortogonal ao .dark: o material entra por data-material no mesmo
  // elemento raiz, para que [data-material="glass"] e .dark[data-material="glass"]
  // se combinem sem duplicar a paleta.
  useEffect(() => {
    window.document.documentElement.dataset.material = material;
  }, [material]);

  const applyMaterial = useCallback((nextMaterial: MaterialVariant) => {
    hasFresherMaterialRef.current = true;
    setMaterialState(nextMaterial);
  }, []);

  // Leitura na MONTAGEM: toda janela precisa do material persistido mesmo que
  // nenhum evento chegue (abrir o Reader com o app ja em glass, por exemplo).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const storedMaterial = await getMaterialVariant(databaseSource).catch(() => "flat" as const);
      if (!cancelled && !hasFresherMaterialRef.current) {
        setMaterialState(storedMaterial);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [databaseSource]);

  // Propagacao cross-window, no mesmo padrao dos eventos do Reader. Aplicar o
  // payload e idempotente, entao a janela que originou a troca pode receber a
  // propria emissao sem efeito nenhum — nao ha filtro por origin aqui.
  useEffect(() => {
    let isDisposed = false;
    let unlisten: (() => void) | null = null;

    void listen<unknown>(MATERIAL_VARIANT_CHANGED_EVENT, (event) => {
      if (!isMaterialVariantChangedPayload(event.payload)) {
        return;
      }

      applyMaterial(event.payload.material);
    })
      .then((removeListener) => {
        if (isDisposed) {
          removeListener();
          return;
        }
        unlisten = removeListener;
      })
      .catch((error) => {
        console.warn("Nao foi possivel sincronizar o material entre as janelas.", error);
      });

    return () => {
      isDisposed = true;
      unlisten?.();
    };
  }, [applyMaterial]);

  const setMaterial = useCallback(
    (nextMaterial: MaterialVariant) => {
      applyMaterial(nextMaterial);
      void setMaterialVariant(nextMaterial, databaseSource).catch((error: unknown) => {
        console.error("Nao foi possivel salvar a preferencia de material.", error);
      });
    },
    [applyMaterial, databaseSource],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
      material,
      setMaterial,
    }),
    [material, setMaterial, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme deve ser usado dentro de ThemeProvider.");
  }

  return context;
}
