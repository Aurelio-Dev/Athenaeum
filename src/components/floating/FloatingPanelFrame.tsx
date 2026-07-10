import { type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFloatingPanels, type FloatingPanel } from "./FloatingPanelsContext";

type FloatingPanelFrameProps = {
  panel: FloatingPanel;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  resizable?: boolean;
  edgeToEdge?: boolean;
  // Conteudo esquerdo do header escuro (titulo). O drag e ligado ao header
  // inteiro; os botoes de acao devem parar a propagacao do mousedown (o
  // slot `actions` ja faz isso).
  title?: ReactNode;
  actions?: ReactNode;
  // Header totalmente customizado (ex.: o leitor de PDF, cujo header tem
  // toolbar propria). Recebe o startDragging para ligar ao onMouseDown do
  // header — controles interativos dentro dele devem parar a propagacao do
  // mousedown para nao iniciar drag. Quando presente, title/actions sao
  // ignorados.
  renderHeader?: (startDragging: (event: MouseEvent<HTMLElement>) => void) => ReactNode;
  onFocusPanel?: () => void;
  onResize?: (size: { width: number; height: number }) => void;
  // Disparado UMA vez ao fim de um arrasto que moveu o painel de verdade
  // (clique parado no header nao conta). Superficies graficas usam este ponto
  // para sincronizar dimensoes e redesenhar depois da mudanca de geometria.
  onMoveEnd?: () => void;
  children: ReactNode;
};

type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

function getEventPanelId(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return null;
  }

  return target.closest<HTMLElement>("[data-floating-panel-id]")?.dataset.floatingPanelId ?? null;
}

// Casca comum dos paineis flutuantes: portal para o <body> (escapa do
// stacking context de modais como o leitor, entao os zIndex da pilha valem
// entre TODOS os paineis), header arrastavel e corpo com resize.
export function FloatingPanelFrame({ panel, width, height, minWidth, minHeight, resizable = true, edgeToEdge = false, title, actions, renderHeader, onFocusPanel, onResize, onMoveEnd, children }: FloatingPanelFrameProps) {
  const { focusPanel, movePanel } = useFloatingPanels();

  function startDragging(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0) {
      return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const initialPosition = panel.position;
    let hasMoved = false;

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      hasMoved = true;
      movePanel(panel.id, {
        x: Math.max(0, initialPosition.x + moveEvent.clientX - startX),
        y: Math.max(0, initialPosition.y + moveEvent.clientY - startY),
      });
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);

      // Fim do arrasto (nao a cada frame): avisa uma unica vez, e somente se
      // o painel realmente saiu do lugar.
      if (hasMoved) {
        onMoveEnd?.();
      }
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  function startResizing(direction: ResizeDirection, event: MouseEvent<HTMLDivElement>) {
    if (event.button !== 0 || !onResize) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    focusPanel(panel.id);
    onFocusPanel?.();
    const resizePanel = onResize;

    const startX = event.clientX;
    const startY = event.clientY;
    const initialPosition = panel.position;
    const initialWidth = width;
    const initialHeight = height;
    const effectiveMinWidth = edgeToEdge ? 0 : minWidth;
    const effectiveMinHeight = edgeToEdge ? 0 : minHeight;

    function handleMouseMove(moveEvent: globalThis.MouseEvent) {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      const right = initialPosition.x + initialWidth;
      const bottom = initialPosition.y + initialHeight;
      let nextX = initialPosition.x;
      let nextY = initialPosition.y;
      let nextWidth = initialWidth;
      let nextHeight = initialHeight;

      if (direction.includes("e")) {
        nextWidth = Math.max(effectiveMinWidth, initialWidth + dx);
      }

      if (direction.includes("s")) {
        nextHeight = Math.max(effectiveMinHeight, initialHeight + dy);
      }

      if (direction.includes("w")) {
        nextX = Math.min(right - effectiveMinWidth, Math.max(0, initialPosition.x + dx));
        nextWidth = right - nextX;
      }

      if (direction.includes("n")) {
        nextY = Math.min(bottom - effectiveMinHeight, Math.max(0, initialPosition.y + dy));
        nextHeight = bottom - nextY;
      }

      if (nextX !== initialPosition.x || nextY !== initialPosition.y) {
        movePanel(panel.id, { x: nextX, y: nextY });
      }
      resizePanel({ width: nextWidth, height: nextHeight });
    }

    function handleMouseUp() {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }

  return createPortal(
    <aside
      className={`fixed flex flex-col overflow-hidden bg-[var(--card)] ${
        edgeToEdge ? "rounded-none border border-transparent shadow-none" : "rounded-xl border border-border-subtle shadow-2xl"
      } ${resizable && !onResize ? "resize" : ""}`}
      style={{
        left: panel.position.x,
        top: panel.position.y,
        width,
        height,
        minWidth: edgeToEdge ? 0 : minWidth,
        minHeight: edgeToEdge ? 0 : minHeight,
        zIndex: panel.zIndex,
      }}
      data-floating-panel-id={panel.id}
      // Capture de pointerdown: qualquer interacao por mouse, caneta ou toque
      // dentro do painel — header, corpo, botoes ou canvas — traz ele para o
      // topo da pilha antes do evento seguir para o alvo, como uma janela de SO.
      //
      // Sem excecao para botoes/inputs: subir o zIndex nao recria o no DOM
      // (o React so atualiza o style do aside), entao o click do controle
      // completa normalmente mesmo com o painel subindo no meio.
      onPointerDownCapture={(event) => {
        if (getEventPanelId(event.target) !== panel.id) {
          return;
        }

        focusPanel(panel.id);
        onFocusPanel?.();
      }}
    >
      {renderHeader ? (
        renderHeader(startDragging)
      ) : (
        <div
          className="flex h-12 shrink-0 cursor-move items-center justify-between rounded-t-xl border-b border-[var(--floating-header-border)] bg-[var(--floating-header-bg)] px-4 text-[var(--floating-header-text)]"
          onMouseDown={startDragging}
        >
          {title}
          {actions ? (
            <div className="flex items-center gap-1" onMouseDown={(event) => event.stopPropagation()}>
              {actions}
            </div>
          ) : null}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">{children}</div>

      {resizable && onResize ? (
        <>
          <div className="absolute left-2 right-2 top-0 z-50 h-2 cursor-ns-resize" onMouseDown={(event) => startResizing("n", event)} />
          <div className="absolute bottom-0 left-2 right-2 z-50 h-2 cursor-ns-resize" onMouseDown={(event) => startResizing("s", event)} />
          <div className="absolute bottom-2 top-2 left-0 z-50 w-2 cursor-ew-resize" onMouseDown={(event) => startResizing("w", event)} />
          <div className="absolute bottom-2 right-0 top-2 z-50 w-2 cursor-ew-resize" onMouseDown={(event) => startResizing("e", event)} />
          <div className="absolute left-0 top-0 z-50 h-3 w-3 cursor-nwse-resize" onMouseDown={(event) => startResizing("nw", event)} />
          <div className="absolute right-0 top-0 z-50 h-3 w-3 cursor-nesw-resize" onMouseDown={(event) => startResizing("ne", event)} />
          <div className="absolute bottom-0 right-0 z-50 h-3 w-3 cursor-nwse-resize" onMouseDown={(event) => startResizing("se", event)} />
          <div className="absolute bottom-0 left-0 z-50 h-3 w-3 cursor-nesw-resize" onMouseDown={(event) => startResizing("sw", event)} />
        </>
      ) : null}
    </aside>,
    window.document.body,
  );
}
