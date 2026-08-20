import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  getMaterialVariant,
  isMaterialVariant,
  isMaterialVariantChangedPayload,
  MATERIAL_VARIANT_CHANGED_EVENT,
  setMaterialVariant,
  type DatabaseHandleSource,
  type MaterialVariant,
} from "../lib/database";
import { useWallpaperBackdrop } from "./useWallpaperBackdrop";

// Fonte UNICA da aparencia global do app: o MODO (claro/escuro) e o MATERIAL
// (chapado/vidro). Vive num contexto para que o botao de contraste do rodape da
// sidebar e o controle "Tema" do SettingsPanel compartilhem o MESMO estado —
// dois useState independentes desincronizariam (um trocaria o tema sem o outro
// perceber).
//
// Os dois eixos sao ortogonais e persistem de formas diferentes:
//
// - MODO so em localStorage. A leitura sincrona antes do primeiro paint evita o
//   flash de tema errado na abertura, que uma leitura assincrona via IPC do
//   banco traria.
// - MATERIAL em app_settings (chave material_variant), como show_divider_lines,
//   com ESPELHO write-through em localStorage. O SQLite continua
//   sendo a FONTE DE VERDADE: e o unico lugar compartilhado pelas 4 janelas
//   nativas (cada uma tem o seu proprio localStorage) e o unico que sobrevive a
//   uma troca feita com a janela fechada. O espelho existe so para o bootstrap
//   ter um valor antes do primeiro paint — pelo mesmo motivo do modo, e porque
//   sem ele as 4 janelas piscavam em 'flat' ate o IPC responder.
//
// Divergencia entre os dois e esperada (outra janela trocou o material enquanto
// esta estava fechada): quem chega depois nao ganha — o SQLite vence e o
// localStorage e corrigido na reconciliacao.
export type Theme = "light" | "dark";

const themeStorageKey = "athenaeum-theme";
const materialStorageKey = "athenaeum-material";

function readStoredTheme(): Theme {
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

// Palpite de bootstrap, nao verdade: vale ate o SQLite responder. Valor ausente
// ou invalido (escrito por uma versao futura) volta ao material historico.
function readCachedMaterial(): MaterialVariant {
  const cachedMaterial = window.localStorage.getItem(materialStorageKey);
  return isMaterialVariant(cachedMaterial) ? cachedMaterial : "flat";
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
  useWallpaperBackdrop(databaseSource);
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  // Inicializador sincrono (mesmo padrao do modo acima): o primeiro commit ja
  // sai com o material em cache, entao nao ha janela pintada em 'flat'.
  const [material, setMaterialState] = useState<MaterialVariant>(readCachedMaterial);
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
  //
  // O espelho no localStorage e escrito AQUI, e nao dentro de setMaterial, para
  // que TODO caminho que muda o material passe por ele: troca local, evento de
  // outra janela e a reconciliacao com o SQLite. E isso que corrige o cache
  // quando ele diverge da fonte de verdade.
  useEffect(() => {
    window.document.documentElement.dataset.material = material;
    window.localStorage.setItem(materialStorageKey, material);
  }, [material]);

  const applyMaterial = useCallback((nextMaterial: MaterialVariant) => {
    hasFresherMaterialRef.current = true;
    setMaterialState(nextMaterial);
  }, []);

  // RECONCILIACAO na montagem: toda janela precisa do material persistido mesmo
  // que nenhum evento chegue (abrir o Reader com o app ja em glass, por
  // exemplo). O valor do SQLite vence o cache; se forem iguais, o setState e
  // no-op e o efeito acima nao reescreve nada.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // Falha de leitura devolve null em vez de 'flat': sem resposta da fonte de
      // verdade nao ha o que reconciliar, e descartar o cache aqui traria de
      // volta exatamente o flash que ele existe para evitar.
      const storedMaterial = await getMaterialVariant(databaseSource).catch(() => null);
      if (cancelled || storedMaterial === null || hasFresherMaterialRef.current) {
        return;
      }

      setMaterialState(storedMaterial);
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
