import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

// Pilha de paineis flutuantes do app (anotações do leitor, editor de caderno,
// futuro editor de quadros). Substitui o antigo `isFloating: boolean`, que so
// suportava um painel por vez: aqui varios paineis coexistem, cada um com
// posicao propria e ordem de empilhamento (zIndex).
export type FloatingPanelType = "annotations" | "notebook" | "canvas" | "reader" | "settings";

export interface FloatingPanel {
  // Deterministico (`${type}-${entityId}`): abrir a mesma entidade duas vezes
  // foca o painel existente em vez de duplicar.
  id: string;
  type: FloatingPanelType;
  // String para cobrir os dois esquemas de id do banco: documents usa TEXT
  // (uuid) e notebooks/canvases usam INTEGER (convertido com String()).
  entityId: string;
  position: { x: number; y: number };
  zIndex: number;
  isMinimized: boolean;
}

// Acima do ReaderModal (z-50), abaixo dos dialogos modais (z-[60]+) — um
// dialogo de confirmacao continua bloqueando os paineis. O zIndex de cada
// painel e derivado da POSICAO na pilha (base + indice), nunca de um contador
// crescente: assim nao ha como "vazar" para a faixa dos dialogos apos muitos
// refocos.
const FLOATING_PANEL_BASE_Z = 55;

function withStackedZIndexes(panels: FloatingPanel[]): FloatingPanel[] {
  return panels.map((panel, index) => ({ ...panel, zIndex: FLOATING_PANEL_BASE_Z + index }));
}

// Paineis novos abrem em cascata (deslocados do canto superior direito) para
// nenhum cobrir totalmente o anterior. panelWidth e a largura REAL do painel
// sendo aberto — com o default (largura do painel de anotacoes), um painel
// mais largo transbordaria a borda direita da janela.
function getCascadePosition(stackSize: number, panelWidth = 440) {
  const x = Math.max(8, window.innerWidth - panelWidth - 24 - stackSize * 32);
  const y = Math.min(94 + stackSize * 32, Math.max(76, window.innerHeight - 200));
  return { x, y };
}

// Posicao centralizada na janela, para paineis grandes (ex.: Quadro) em que a
// cascata de canto nao faz sentido. Clamp para nunca abrir com o header acima
// do topo ou fora da esquerda em janelas pequenas.
export function getCenteredPanelPosition(panelWidth: number, panelHeight: number) {
  return {
    x: Math.max(8, Math.round((window.innerWidth - panelWidth) / 2)),
    y: Math.max(60, Math.round((window.innerHeight - panelHeight) / 2)),
  };
}

type FloatingPanelsContextValue = {
  panels: FloatingPanel[];
  openPanel: (type: FloatingPanelType, entityId: string, initialPosition?: { x: number; y: number }, panelWidth?: number) => void;
  closePanel: (panelId: string) => void;
  focusPanel: (panelId: string) => void;
  minimizePanel: (panelId: string) => void;
  restorePanel: (panelId: string) => void;
  movePanel: (panelId: string, position: { x: number; y: number }) => void;
};

const FloatingPanelsContext = createContext<FloatingPanelsContextValue | null>(null);

export function floatingPanelId(type: FloatingPanelType, entityId: string) {
  return `${type}-${entityId}`;
}

export function FloatingPanelsProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<FloatingPanel[]>([]);

  const focusPanel = useCallback((panelId: string) => {
    setPanels((currentPanels) => {
      const panel = currentPanels.find((currentPanel) => currentPanel.id === panelId);

      // Ja esta no topo (ultimo da pilha) ou nao existe: nada a fazer. Foco
      // nao restaura painel minimizado; isso fica reservado para a acao
      // explicita de restaurar ou para reabrir a entidade.
      if (!panel || currentPanels[currentPanels.length - 1] === panel) {
        return currentPanels;
      }

      const others = currentPanels.filter((currentPanel) => currentPanel.id !== panelId);
      return withStackedZIndexes([...others, panel]);
    });
  }, []);

  const minimizePanel = useCallback((panelId: string) => {
    setPanels((currentPanels) => {
      const panel = currentPanels.find((currentPanel) => currentPanel.id === panelId);

      if (!panel) {
        return currentPanels;
      }

      const others = currentPanels.filter((currentPanel) => currentPanel.id !== panelId);
      return withStackedZIndexes([...others, { ...panel, isMinimized: true }]);
    });
  }, []);

  const restorePanel = useCallback((panelId: string) => {
    setPanels((currentPanels) => {
      const panel = currentPanels.find((currentPanel) => currentPanel.id === panelId);

      if (!panel) {
        return currentPanels;
      }

      const others = currentPanels.filter((currentPanel) => currentPanel.id !== panelId);
      return withStackedZIndexes([...others, { ...panel, isMinimized: false }]);
    });
  }, []);

  const openPanel = useCallback(
    // panelWidth so influencia o fallback de cascata (sem initialPosition):
    // e a largura real do painel, para ele nao abrir transbordando a direita.
    (type: FloatingPanelType, entityId: string, initialPosition?: { x: number; y: number }, panelWidth?: number) => {
      setPanels((currentPanels) => {
        const id = floatingPanelId(type, entityId);
        const existingPanel = currentPanels.find((currentPanel) => currentPanel.id === id);

        // Reabrir uma entidade ja aberta so traz o painel dela para frente.
        if (existingPanel) {
          const others = currentPanels.filter((currentPanel) => currentPanel.id !== id);
          return withStackedZIndexes([...others, { ...existingPanel, isMinimized: false }]);
        }

        const newPanel: FloatingPanel = {
          id,
          type,
          entityId,
          position: initialPosition ?? getCascadePosition(currentPanels.length, panelWidth),
          zIndex: 0, // recalculado por withStackedZIndexes logo abaixo
          isMinimized: false,
        };

        return withStackedZIndexes([...currentPanels, newPanel]);
      });
    },
    [],
  );

  const closePanel = useCallback((panelId: string) => {
    setPanels((currentPanels) => {
      if (!currentPanels.some((currentPanel) => currentPanel.id === panelId)) {
        return currentPanels;
      }

      return withStackedZIndexes(currentPanels.filter((currentPanel) => currentPanel.id !== panelId));
    });
  }, []);

  const movePanel = useCallback((panelId: string, position: { x: number; y: number }) => {
    setPanels((currentPanels) =>
      currentPanels.map((currentPanel) => (currentPanel.id === panelId ? { ...currentPanel, position } : currentPanel)),
    );
  }, []);

  const value = useMemo(
    () => ({ panels, openPanel, closePanel, focusPanel, minimizePanel, restorePanel, movePanel }),
    [panels, openPanel, closePanel, focusPanel, minimizePanel, restorePanel, movePanel],
  );

  return <FloatingPanelsContext.Provider value={value}>{children}</FloatingPanelsContext.Provider>;
}

export function useFloatingPanels() {
  const context = useContext(FloatingPanelsContext);

  if (!context) {
    throw new Error("useFloatingPanels deve ser usado dentro de FloatingPanelsProvider.");
  }

  return context;
}
