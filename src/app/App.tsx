import { FloatingPanelsProvider } from "../components/floating/FloatingPanelsContext";
import { ThemeProvider } from "../hooks/useTheme";
import { LibraryView } from "../features/library/LibraryView";
import { AppIconProvider } from "../lib/appIcon";
import { DividerLinesProvider } from "../hooks/useDividerLines";

export function App() {
  return (
    // ThemeProvider por fora: a preferencia de tema (claro/escuro) e fonte unica
    // compartilhada pela sidebar e pelo SettingsPanel, e precisa envolver toda a
    // arvore para aplicar a classe .dark no <html>.
    <ThemeProvider>
      <DividerLinesProvider>
        <AppIconProvider>
          {/* Pilha de paineis flutuantes no topo da arvore: anotacoes do leitor e
          editores de caderno/quadro compartilham a mesma pilha, entao podem
          coexistir e se sobrepor com ordem de foco correta. */}
          <FloatingPanelsProvider>
            <LibraryView />
          </FloatingPanelsProvider>
        </AppIconProvider>
      </DividerLinesProvider>
    </ThemeProvider>
  );
}
