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
const ReaderWindowRoot = lazy(() =>
  import("../features/reader/ReaderWindowRoot").then((module) => ({ default: module.ReaderWindowRoot })),
);
// KaTeX junto, como no LibraryView: o editor do Caderno renderiza equacoes.
const NotebookWindowRoot = lazy(async () => {
  const [, module] = await Promise.all([import("katex/dist/katex.min.css"), import("../features/notebooks/NotebookWindowRoot")]);
  return { default: module.NotebookWindowRoot };
});

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-sm font-semibold text-[var(--muted-foreground)]">
      Carregando...
    </div>
  );
}

export function App() {
  const searchParams = new URLSearchParams(window.location.search);

  if (searchParams.get("readerWindow") === "1") {
    const documentId = searchParams.get("documentId") ?? "";

    return (
      <Suspense fallback={<LoadingScreen />}>
        <ReaderWindowRoot documentId={documentId} />
      </Suspense>
    );
  }

  if (searchParams.get("readerPanel") === "1") {
    const documentId = searchParams.get("documentId") ?? "";

    return (
      // databaseSource="preloaded": a janela nao chama Database.load (ver o
      // cabecalho da ReaderPanelPopout), e o ThemeProvider le o material do
      // banco na montagem.
      <ThemeProvider databaseSource="preloaded">
        <Suspense fallback={<LoadingScreen />}>
          <ReaderPanelPopout documentId={documentId} />
        </Suspense>
      </ThemeProvider>
    );
  }

  // Janela nativa de Caderno: standalone, sem FloatingPanelsProvider nem o
  // resto da arvore principal — mesmo modelo do branch da popout do Reader.
  if (searchParams.get("notebookPanel") === "1") {
    const notebookId = Number(searchParams.get("notebookId") ?? "");

    return (
      <ThemeProvider databaseSource="preloaded">
        <Suspense fallback={<LoadingScreen />}>
          <NotebookWindowRoot notebookId={notebookId} />
        </Suspense>
      </ThemeProvider>
    );
  }

  return (
    // ThemeProvider por fora: as preferencias de tema (claro/escuro) e de
    // material sao fonte unica compartilhada pela sidebar e pelo SettingsPanel,
    // e precisam envolver toda a arvore para aplicar a classe .dark e o
    // data-material no <html>.
    <ThemeProvider>
      <AppearancePreferencesProvider>
        <DividerLinesProvider>
          {/* Pilha dos paineis internos de Quadro e Ajustes. Reader, Caderno e
            Anotacoes usam janelas nativas independentes. */}
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
