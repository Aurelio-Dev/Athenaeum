import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import {
  applyDiagramScale,
  clampDiagramScale,
  diagramScaleDefaultPercent,
  diagramScaleMaxPercent,
  diagramScaleMinPercent,
  parseDiagramScale,
  stepDiagramScale,
} from "./notebookDiagramScale";

// Frame compartilhado pelos previews de diagram, graph e flowchart.
//
// Modelo de escala (Fase 8.1): o conteúdo tem um layout NATURAL fixo
// (width: max-content, independente da escala) medido por ResizeObserver —
// que reporta caixas não transformadas, ao contrário de getBoundingClientRect.
// A escala é um transform: scale() uniforme sobre esse layout, e a "box"
// intermediária reserva naturalWidth × escala por naturalHeight × escala no
// fluxo, para o texto abaixo acompanhar o fim do frame. Redimensionar nunca
// reflui o layout interno — é o oposto do antigo data-diagram-width, que só
// estreitava o contêiner responsivo.
//
// Quando a escala pedida não cabe na largura do editor, a escala EFETIVA é
// limitada em runtime (sem overflow horizontal), mas data-diagram-scale
// preserva a preferência e o tamanho volta quando houver espaço.

const DiagramFrameWidthContext = createContext<number | null>(null);

// Largura não transformada disponível para o frame (px); null antes da
// primeira medição. É a base da responsividade de layout por janela (ex.:
// colunas da grade do graph), separada do redimensionamento manual — ela não
// muda durante um drag de escala.
export function useDiagramFrameWidth(): number | null {
  return useContext(DiagramFrameWidthContext);
}

type NotebookDiagramFrameProps = {
  children: ReactNode;
};

type NaturalSize = {
  width: number;
  height: number;
};

type HandleCorner = "nw" | "ne" | "sw" | "se";

const handleCorners: readonly HandleCorner[] = ["nw", "ne", "sw", "se"];

type DragState = {
  pointerId: number;
  anchorX: number;
  anchorY: number;
  startDistance: number;
  startScale: number;
  pendingScale: number;
  rafId: number | null;
};

function findDiagramBlock(node: HTMLElement | null): HTMLElement | null {
  const diagram = node?.closest('[data-athenaeum-block="diagram"]');
  return diagram instanceof HTMLElement ? diagram : null;
}

// Fator aplicado de fato: a preferência, limitada ao que cabe na largura
// disponível (só limita ampliação — reduzir sempre cabe).
function getEffectiveScaleFactor(
  scalePercent: number,
  naturalSize: NaturalSize | null,
  availableWidth: number | null,
): number {
  const preferredFactor = scalePercent / 100;
  if (!naturalSize || naturalSize.width <= 0 || availableWidth === null || availableWidth <= 0) {
    return preferredFactor;
  }

  return Math.min(preferredFactor, availableWidth / naturalSize.width);
}

// Uma única persistência + um único "input" por interação (autosave).
function commitDiagramScale(diagram: HTMLElement, scale: number) {
  applyDiagramScale(diagram, scale);
  diagram.dispatchEvent(new Event("input", { bubbles: true }));
}

export function NotebookDiagramFrame({ children }: NotebookDiagramFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const pointerInsideBlockRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const naturalSizeRef = useRef<NaturalSize | null>(null);
  const frameWidthRef = useRef<number | null>(null);
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);
  const [scalePercent, setScalePercent] = useState(diagramScaleDefaultPercent);
  const [isBlockActive, setIsBlockActive] = useState(false);
  const [isHandleFocused, setIsHandleFocused] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content) {
      return;
    }

    const diagram = findDiagramBlock(frame);
    setScalePercent(parseDiagramScale(diagram?.dataset.diagramScale) ?? diagramScaleDefaultPercent);

    const frameObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") {
        const rounded = Math.round(width);
        frameWidthRef.current = rounded;
        setFrameWidth(rounded);
      }
    });
    frameObserver.observe(frame);

    // Dimensões naturais (não escaladas): ResizeObserver reporta a caixa de
    // layout, que não é afetada por transform: scale.
    const contentObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const borderBox = entry.borderBoxSize?.[0];
      const next: NaturalSize = {
        width: Math.round(borderBox ? borderBox.inlineSize : entry.contentRect.width),
        height: Math.round(borderBox ? borderBox.blockSize : entry.contentRect.height),
      };
      naturalSizeRef.current = next;
      setNaturalSize((previous) =>
        previous && previous.width === next.width && previous.height === next.height ? previous : next,
      );
    });
    contentObserver.observe(content);

    // Sincroniza mudanças externas do atributo (normalização, undo, migração
    // da largura legada) com o estado do frame.
    const attributeObserver = diagram
      ? new MutationObserver(() => {
          setScalePercent(parseDiagramScale(diagram.dataset.diagramScale) ?? diagramScaleDefaultPercent);
        })
      : null;
    attributeObserver?.observe(diagram as HTMLElement, {
      attributes: true,
      attributeFilter: ["data-diagram-scale"],
    });

    // "Selecionado ou focado": caret dentro do bloco OU último pointerdown
    // dentro dele (clicar no SVG não move o caret para dentro do bloco).
    function handleDocumentPointerDown(event: Event) {
      const target = event.target;
      const inside = Boolean(diagram && target instanceof Node && diagram.contains(target));
      pointerInsideBlockRef.current = inside;
      setIsBlockActive(inside);
    }

    function handleSelectionChange() {
      if (!diagram) {
        return;
      }

      const anchorNode = document.getSelection()?.anchorNode ?? null;
      const selectionInside = Boolean(anchorNode && diagram.contains(anchorNode));
      setIsBlockActive(selectionInside || pointerInsideBlockRef.current);
    }

    function handleDocumentFocusIn(event: Event) {
      if (!diagram) {
        return;
      }

      const focusInside = event.target instanceof Node && diagram.contains(event.target);
      if (focusInside) {
        setIsBlockActive(true);
        return;
      }

      pointerInsideBlockRef.current = false;
      setIsBlockActive(false);
    }

    function handleWindowBlur() {
      pointerInsideBlockRef.current = false;
      setIsBlockActive(false);
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("focusin", handleDocumentFocusIn);
    window.addEventListener("blur", handleWindowBlur);

    return () => {
      frameObserver.disconnect();
      contentObserver.disconnect();
      attributeObserver?.disconnect();
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("focusin", handleDocumentFocusIn);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  // Aplica a escala pendente do drag sem passar pelo React (rAF-throttled):
  // transform no conteúdo + reserva de espaço na box.
  function applyRuntimeScale(pendingScale: number) {
    const box = boxRef.current;
    const content = contentRef.current;
    const natural = naturalSizeRef.current;
    const factor = getEffectiveScaleFactor(pendingScale, natural, frameWidthRef.current);

    if (content) {
      content.style.transform = `scale(${factor})`;
    }
    if (box && natural) {
      box.style.width = `${natural.width * factor}px`;
      box.style.height = `${natural.height * factor}px`;
    }
  }

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    if (dragState.rafId !== null) {
      cancelAnimationFrame(dragState.rafId);
      applyRuntimeScale(dragState.pendingScale);
    }
    dragStateRef.current = null;
    setIsResizing(false);

    const diagram = findDiagramBlock(frameRef.current);
    if (diagram) {
      commitDiagramScale(diagram, dragState.pendingScale);
      setScalePercent(dragState.pendingScale);
    }
  }

  function handleHandlePointerDown(event: PointerEvent<HTMLDivElement>, corner: HandleCorner) {
    const box = boxRef.current;
    const diagram = findDiagramBlock(frameRef.current);
    if (!box || !diagram) {
      return;
    }

    // Âncora no canto oposto da caixa escalada visível.
    const rect = box.getBoundingClientRect();
    const anchorX = corner === "nw" || corner === "sw" ? rect.right : rect.left;
    const anchorY = corner === "nw" || corner === "ne" ? rect.bottom : rect.top;
    const startDistance = Math.hypot(event.clientX - anchorX, event.clientY - anchorY);
    if (startDistance <= 0) {
      return;
    }

    // Impede que o arrasto mova o caret ou selecione texto no contentEditable.
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    // Base do drag: a escala efetiva atual (o que o usuário vê), não a
    // preferência persistida, para o movimento não "pular" quando a
    // preferência estiver limitada pela largura do editor.
    const startScale = clampDiagramScale(
      getEffectiveScaleFactor(scalePercent, naturalSizeRef.current, frameWidthRef.current) * 100,
    );
    dragStateRef.current = {
      pointerId: event.pointerId,
      anchorX,
      anchorY,
      startDistance,
      startScale,
      pendingScale: startScale,
      rafId: null,
    };
    setIsResizing(true);
  }

  function handleHandlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    // Fator uniforme: razão entre a distância atual e a inicial até a âncora.
    const distance = Math.hypot(event.clientX - dragState.anchorX, event.clientY - dragState.anchorY);
    dragState.pendingScale = clampDiagramScale(dragState.startScale * (distance / dragState.startDistance));

    if (dragState.rafId !== null) {
      return;
    }

    dragState.rafId = requestAnimationFrame(() => {
      dragState.rafId = null;
      applyRuntimeScale(dragState.pendingScale);
    });
  }

  function handleHandleDoubleClick() {
    const diagram = findDiagramBlock(frameRef.current);
    if (!diagram) {
      return;
    }

    // applyDiagramScale trata 100 como padrão e remove o atributo.
    commitDiagramScale(diagram, diagramScaleDefaultPercent);
    setScalePercent(diagramScaleDefaultPercent);
  }

  function handleHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      pointerInsideBlockRef.current = false;
      setIsBlockActive(false);
      return;
    }

    const diagram = findDiagramBlock(frameRef.current);
    if (!diagram) {
      return;
    }

    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = stepDiagramScale(scalePercent, 1, event.shiftKey);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = stepDiagramScale(scalePercent, -1, event.shiftKey);
    } else if (event.key === "Home") {
      next = diagramScaleMinPercent;
    } else if (event.key === "End") {
      next = diagramScaleMaxPercent;
    }

    if (next === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitDiagramScale(diagram, next);
    setScalePercent(next);
  }

  const effectiveFactor = getEffectiveScaleFactor(scalePercent, naturalSize, frameWidth);
  const boxStyle: CSSProperties | undefined = naturalSize
    ? { width: naturalSize.width * effectiveFactor, height: naturalSize.height * effectiveFactor }
    : undefined;
  const contentStyle: CSSProperties = { transform: `scale(${effectiveFactor})` };
  const showHandles = isBlockActive || isHandleFocused || isResizing;

  return (
    <div
      ref={frameRef}
      className="notebook-diagram-frame"
      data-frame-active={showHandles ? "true" : undefined}
      data-frame-resizing={isResizing ? "true" : undefined}
    >
      <div ref={boxRef} className="notebook-diagram-frame-box" style={boxStyle}>
        <div ref={contentRef} className="notebook-diagram-frame-content" style={contentStyle}>
          <DiagramFrameWidthContext.Provider value={frameWidth}>{children}</DiagramFrameWidthContext.Provider>
        </div>
        {handleCorners.map((corner) => (
          <div
            key={corner}
            role="slider"
            tabIndex={0}
            contentEditable={false}
            className="notebook-diagram-resize-handle"
            data-handle-corner={corner}
            aria-label="Redimensionar diagrama"
            aria-orientation="horizontal"
            aria-valuemin={diagramScaleMinPercent}
            aria-valuemax={diagramScaleMaxPercent}
            aria-valuenow={scalePercent}
            aria-valuetext={`${scalePercent}%`}
            onPointerDown={(event) => handleHandlePointerDown(event, corner)}
            onPointerMove={handleHandlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            onDoubleClick={handleHandleDoubleClick}
            onKeyDown={handleHandleKeyDown}
            onFocus={() => setIsHandleFocused(true)}
            onBlur={() => setIsHandleFocused(false)}
          />
        ))}
      </div>
    </div>
  );
}
