import { FloatingPanelsProvider } from "../components/floating/FloatingPanelsContext";
import { LibraryView } from "../features/library/LibraryView";

export function App() {
  return (
    // Pilha de paineis flutuantes no topo da arvore: anotacoes do leitor e
    // editores de caderno/quadro compartilham a mesma pilha, entao podem
    // coexistir e se sobrepor com ordem de foco correta.
    <FloatingPanelsProvider>
      <LibraryView />
    </FloatingPanelsProvider>
  );
}
