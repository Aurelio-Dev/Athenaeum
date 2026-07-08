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
  clampResizableScale,
  diagramScaleDefaultPercent,
  parseDiagramScale,
  resizableScaleDefaultPercent,
  resizableScaleMaxPercent,
  resizableScaleMinPercent,
  stepDiagramScale,
} from "./notebookDiagramScale";

// Frame compartilhado por diagramas, grafos, fluxogramas, equacoes e figuras.
//
// Modelo de escala: o conteudo tem um layout natural fixo (width: max-content,
// independente da escala) medido por ResizeObserver. A escala e um
// transform: scale() uniforme sobre esse layout, e a "box" intermediaria
// reserva naturalWidth x escala por naturalHeight x escala no fluxo. Quando a
// escala pedida nao cabe na largura util, a escala efetiva e limitada em
// runtime, mas o atributo persistido preserva a preferencia.

const DiagramFrameWidthContext = createContext<number | null>(null);

// Largura nao transformada disponivel para o frame (px); usada pelos grafos
// para escolher responsivamente a distribuicao interna.
export function useDiagramFrameWidth(): number | null {
  return useContext(DiagramFrameWidthContext);
}

type NotebookDiagramFrameProps = {
  children: ReactNode;
};

type NotebookResizableFrameProps = {
  children: ReactNode;
  blockSelector: string;
  scaleAttributeName: string;
  parseScale: (value: string | null | undefined) => number | null;
  applyScale: (block: HTMLElement, scale: number | null) => void;
  ariaLabel: string;
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

function findResizableBlock(node: HTMLElement | null, selector: string): HTMLElement | null {
  const block = node?.closest(selector);
  return block instanceof HTMLElement ? block : null;
}

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

function commitResizableScale(
  block: HTMLElement,
  scale: number,
  applyScale: (block: HTMLElement, scale: number | null) => void,
) {
  applyScale(block, scale);
  block.dispatchEvent(new Event("input", { bubbles: true }));
}

export function NotebookResizableFrame({
  children,
  blockSelector,
  scaleAttributeName,
  parseScale,
  applyScale,
  ariaLabel,
}: NotebookResizableFrameProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const activeHandleRef = useRef<HTMLDivElement | null>(null);
  const pointerInsideBlockRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const naturalSizeRef = useRef<NaturalSize | null>(null);
  const frameWidthRef = useRef<number | null>(null);
  const [frameWidth, setFrameWidth] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<NaturalSize | null>(null);
  const [scalePercent, setScalePercent] = useState(resizableScaleDefaultPercent);
  const [isBlockActive, setIsBlockActive] = useState(false);
  const [isHandleFocused, setIsHandleFocused] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  function findBlock() {
    return findResizableBlock(frameRef.current, blockSelector);
  }

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

  function finishActiveDrag(updateReactState = true) {
    const dragState = dragStateRef.current;
    if (!dragState) {
      return;
    }

    if (dragState.rafId !== null) {
      cancelAnimationFrame(dragState.rafId);
      applyRuntimeScale(dragState.pendingScale);
    }

    const activeHandle = activeHandleRef.current;
    if (activeHandle?.hasPointerCapture(dragState.pointerId)) {
      activeHandle.releasePointerCapture(dragState.pointerId);
    }

    dragStateRef.current = null;
    activeHandleRef.current = null;

    if (updateReactState) {
      setIsResizing(false);
    }

    const block = findBlock();
    if (block) {
      commitResizableScale(block, dragState.pendingScale, applyScale);
      if (updateReactState) {
        setScalePercent(dragState.pendingScale);
      }
    }
  }

  useEffect(() => {
    const frame = frameRef.current;
    const content = contentRef.current;
    if (!frame || !content) {
      return;
    }

    const block = findResizableBlock(frame, blockSelector);
    setScalePercent(parseScale(block?.getAttribute(scaleAttributeName)) ?? resizableScaleDefaultPercent);

    const frameObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") {
        const rounded = Math.round(width);
        frameWidthRef.current = rounded;
        setFrameWidth(rounded);
      }
    });
    frameObserver.observe(frame);

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

    const attributeObserver = block
      ? new MutationObserver(() => {
          setScalePercent(parseScale(block.getAttribute(scaleAttributeName)) ?? resizableScaleDefaultPercent);
        })
      : null;
    attributeObserver?.observe(block as HTMLElement, {
      attributes: true,
      attributeFilter: [scaleAttributeName],
    });

    function handleDocumentPointerDown(event: Event) {
      const target = event.target;
      const inside = Boolean(block && target instanceof Node && block.contains(target));
      pointerInsideBlockRef.current = inside;
      setIsBlockActive(inside);
    }

    function handleSelectionChange() {
      if (!block) {
        return;
      }

      const anchorNode = document.getSelection()?.anchorNode ?? null;
      const selectionInside = Boolean(anchorNode && block.contains(anchorNode));
      setIsBlockActive(selectionInside || pointerInsideBlockRef.current);
    }

    function handleDocumentFocusIn(event: Event) {
      if (!block) {
        return;
      }

      const focusInside = event.target instanceof Node && block.contains(event.target);
      if (focusInside) {
        setIsBlockActive(true);
        return;
      }

      pointerInsideBlockRef.current = false;
      setIsBlockActive(false);
    }

    function finishBecauseInteractionWasInterrupted() {
      finishActiveDrag();
      pointerInsideBlockRef.current = false;
      setIsBlockActive(false);
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") {
        finishBecauseInteractionWasInterrupted();
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown, true);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("focusin", handleDocumentFocusIn);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("blur", finishBecauseInteractionWasInterrupted);

    return () => {
      finishActiveDrag(false);
      frameObserver.disconnect();
      contentObserver.disconnect();
      attributeObserver?.disconnect();
      document.removeEventListener("pointerdown", handleDocumentPointerDown, true);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("focusin", handleDocumentFocusIn);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", finishBecauseInteractionWasInterrupted);
    };
    // O frame e montado uma vez por preview runtime; os callbacks sao estaveis
    // por renderizacao do bloco.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function finishDrag(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }

    finishActiveDrag();
  }

  function handleHandlePointerDown(event: PointerEvent<HTMLDivElement>, corner: HandleCorner) {
    const box = boxRef.current;
    const block = findBlock();
    if (!box || !block) {
      return;
    }

    const rect = box.getBoundingClientRect();
    const anchorX = corner === "nw" || corner === "sw" ? rect.right : rect.left;
    const anchorY = corner === "nw" || corner === "ne" ? rect.bottom : rect.top;
    const startDistance = Math.hypot(event.clientX - anchorX, event.clientY - anchorY);
    if (startDistance <= 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    activeHandleRef.current = event.currentTarget;

    const startScale = clampResizableScale(
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

    const distance = Math.hypot(event.clientX - dragState.anchorX, event.clientY - dragState.anchorY);
    dragState.pendingScale = clampResizableScale(dragState.startScale * (distance / dragState.startDistance));

    if (dragState.rafId !== null) {
      return;
    }

    dragState.rafId = requestAnimationFrame(() => {
      dragState.rafId = null;
      applyRuntimeScale(dragState.pendingScale);
    });
  }

  function handleHandleDoubleClick() {
    const block = findBlock();
    if (!block) {
      return;
    }

    commitResizableScale(block, resizableScaleDefaultPercent, applyScale);
    setScalePercent(resizableScaleDefaultPercent);
  }

  function handleHandleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.currentTarget.blur();
      pointerInsideBlockRef.current = false;
      setIsBlockActive(false);
      return;
    }

    const block = findBlock();
    if (!block) {
      return;
    }

    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = stepDiagramScale(scalePercent, 1, event.shiftKey);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = stepDiagramScale(scalePercent, -1, event.shiftKey);
    } else if (event.key === "Home") {
      next = resizableScaleMinPercent;
    } else if (event.key === "End") {
      next = resizableScaleMaxPercent;
    }

    if (next === null) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    commitResizableScale(block, next, applyScale);
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
            aria-label={ariaLabel}
            aria-orientation="horizontal"
            aria-valuemin={resizableScaleMinPercent}
            aria-valuemax={resizableScaleMaxPercent}
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

export function NotebookDiagramFrame({ children }: NotebookDiagramFrameProps) {
  return (
    <NotebookResizableFrame
      blockSelector='[data-athenaeum-block="diagram"]'
      scaleAttributeName="data-diagram-scale"
      parseScale={parseDiagramScale}
      applyScale={applyDiagramScale}
      ariaLabel="Redimensionar diagrama"
    >
      {children}
    </NotebookResizableFrame>
  );
}

export { diagramScaleDefaultPercent };
