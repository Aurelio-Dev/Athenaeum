import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

// Fonte UNICA do tema (claro/escuro) do app. Vive num contexto para que o
// botao de contraste do rodape da sidebar e o controle "Tema" do SettingsPanel
// compartilhem o MESMO estado — dois useState independentes desincronizariam
// (um trocaria o tema sem o outro perceber).
//
// Persistencia em localStorage de PROPOSITO (nao em app_settings/SQLite): a
// leitura sincrona antes do primeiro paint evita o flash de tema errado na
// abertura, que uma leitura assincrona via IPC do banco traria.
export type Theme = "light" | "dark";

const themeStorageKey = "athenaeum-theme";

function readStoredTheme(): Theme {
  return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
}

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  // Aplica a classe .dark no <html> (que liga as variaveis CSS do tema escuro,
  // ver styles/index.css) e persiste a escolha. Roda no mount para restaurar a
  // preferencia salva e a cada troca.
  useEffect(() => {
    window.document.documentElement.classList.toggle("dark", theme === "dark");
    window.localStorage.setItem(themeStorageKey, theme);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
    }),
    [theme],
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
