import { lazy, Suspense } from "react";
import { FloatingPanelsProvider } from "../components/floating/FloatingPanelsContext";
import { ThemeProvider } from "../hooks/useTheme";
import { DividerLinesProvider } from "../hooks/useDividerLines";
import { AppearancePreferencesProvider } from "../hooks/useAppearancePreferences";

const LibraryView = lazy(async () => {
  const [, module] = await Promise.all([import("katex/dist/katex.min.css"), import("../features/library/LibraryView")]);
  return { default: module.LibraryView };
});
const ReaderPanelPopout = lazy(() =>
  import("../features/reader/ReaderPanelPopout").then((module) => ({ default: module.ReaderPanelPopout })),
);

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-sm font-semibold text-[var(--muted-foreground)]">
      Carregando...
    </div>
  );
}

export function App() {
  const searchParams = new URLSearchParams(window.location.search);

  if (searchParams.get("readerPanel") === "1") {
    const documentId = searchParams.get("documentId") ?? "";

    return (
      <ThemeProvider>
        <Suspense fallback={<LoadingScreen />}>
          <ReaderPanelPopout documentId={documentId} />
        </Suspense>
      </ThemeProvider>
    );
  }

  return (
    // ThemeProvider por fora: a preferencia de tema (claro/escuro) e fonte unica
    // compartilhada pela sidebar e pelo SettingsPanel, e precisa envolver toda a
    // arvore para aplicar a classe .dark no <html>.
    <ThemeProvider>
      <AppearancePreferencesProvider>
        <DividerLinesProvider>
          {/* Pilha de paineis flutuantes no topo da arvore: anotacoes do leitor e
            editores de caderno/quadro compartilham a mesma pilha, entao podem
            coexistir e se sobrepor com ordem de foco correta. */}
          <FloatingPanelsProvider>
            <Suspense fallback={<LoadingScreen />}>
              <LibraryView />
            </Suspense>
          </FloatingPanelsProvider>
        </DividerLinesProvider>
      </AppearancePreferencesProvider>
    </ThemeProvider>
  );
}
